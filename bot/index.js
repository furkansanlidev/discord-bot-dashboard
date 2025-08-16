require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');
const express = require('express');
const cron = require('node-cron');
const Database = require('./database');

// Initialize database
const db = new Database(process.env.SQLITE_PATH);

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Store active cron jobs
const cronJobs = new Map();

// Initialize Express server for HTTP API
const app = express();
app.use(express.json());

// Add CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'http://localhost:3000');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, x-logs-token');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Middleware to check logs token
const authenticateLogsToken = (req, res, next) => {
  const token = req.headers['x-logs-token'];
  if (token !== process.env.LOGS_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// HTTP API endpoints
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.post('/tick', authenticateLogsToken, (req, res) => {
  res.json({ message: 'Tick processed' });
});

app.post('/add-reminder', authenticateLogsToken, async (req, res) => {
  try {
    const { content, channel_id, user_id, time } = req.body;
    
    const stmt = db.db.prepare(`
      INSERT INTO reminders (content, channel_id, user_id, time)
      VALUES (?, ?, ?, ?)
    `);
    
    const result = stmt.run(content, channel_id, user_id, time);
    stmt.finalize();
    
    scheduleReminder(result.lastID, content, channel_id, user_id, time);
    
    db.logActivity('activity:reminder_added', {
      source: 'http_api',
      channel_id,
      user_id,
      ref_id: result.lastID
    });
    
    res.json({ message: 'Reminder added', id: result.lastID });
  } catch (error) {
    console.error('Error adding reminder:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/add-task', authenticateLogsToken, async (req, res) => {
  try {
    const { content, channel_id, user_id, time, days } = req.body;
    
    const stmt = db.db.prepare(`
      INSERT INTO tasks (content, channel_id, user_id, time, days)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(content, channel_id, user_id, time, days || null);
    stmt.finalize();
    
    scheduleTask(result.lastID, content, channel_id, user_id, time, days);
    
    db.logActivity('activity:task_added', {
      source: 'http_api',
      channel_id,
      user_id,
      ref_id: result.lastID
    });
    
    res.json({ message: 'Task added', id: result.lastID });
  } catch (error) {
    console.error('Error adding task:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/send-once', authenticateLogsToken, async (req, res) => {
  try {
    const { content, channel_id } = req.body;
    
    const channel = client.channels.cache.get(channel_id);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    
    const message = await channel.send(content);
    
    db.logSend('send_once', {
      source: 'http_api',
      channel_id,
      content,
      status: 'sent',
      message_id: message.id
    });
    
    res.json({ message: 'Message sent', message_id: message.id });
  } catch (error) {
    console.error('Error sending message:', error);
    
    db.logSend('send_once', {
      source: 'http_api',
      channel_id: req.body.channel_id,
      content: req.body.content,
      status: 'failed',
      error: error.message
    });
    
    res.status(500).json({ error: error.message });
  }
});

app.post('/rotate-logs', authenticateLogsToken, async (req, res) => {
  try {
    const { maxAge = 30 } = req.body;
    
    const archivedRecords = await db.rotateLogs(maxAge);
    
    db.logActivity('activity:logs_rotated', {
      source: 'http_api',
      status: 'success',
      metadata: { maxAge, archivedRecords }
    });
    
    res.json({ 
      message: 'Log rotation completed', 
      archivedRecords,
      maxAge
    });
  } catch (error) {
    console.error('Error rotating logs:', error);
    
    db.logActivity('activity:logs_rotation_failed', {
      source: 'http_api',
      status: 'failed',
      error: error.message
    });
    
    res.status(500).json({ error: error.message });
  }
});

app.get('/stats', authenticateLogsToken, async (req, res) => {
  try {
    const stats = await db.getStats();
    
    res.json({
      ...stats,
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper functions
function scheduleReminder(id, content, channelId, userId, time) {
  const [hours, minutes] = time.split(':').map(Number);
  const cronPattern = `${minutes} ${hours} * * *`;
  
  const job = cron.schedule(cronPattern, async () => {
    try {
      const channel = client.channels.cache.get(channelId);
      if (channel) {
        const message = await channel.send(`⏰ **Reminder:** ${content}`);
        
        db.logSend('reminder', {
          source: 'cron',
          channel_id: channelId,
          user_id: userId,
          content: `⏰ **Reminder:** ${content}`,
          status: 'sent',
          message_id: message.id,
          ref_id: id
        });
      }
    } catch (error) {
      console.error('Error sending reminder:', error);
      
      db.logSend('reminder', {
        source: 'cron',
        channel_id: channelId,
        user_id: userId,
        content: `⏰ **Reminder:** ${content}`,
        status: 'failed',
        error: error.message,
        ref_id: id
      });
    }
  }, { scheduled: false });
  
  cronJobs.set(`reminder_${id}`, job);
  job.start();
  
  console.log(`Scheduled reminder ${id} for ${time} daily`);
}

function scheduleTask(id, content, channelId, userId, time, days) {
  const [hours, minutes] = time.split(':').map(Number);
  let cronPattern;
  
  if (days) {
    const dayNumbers = days.split(',').map(d => parseInt(d.trim()));
    cronPattern = `${minutes} ${hours} * * ${dayNumbers.join(',')}`;
  } else {
    cronPattern = `${minutes} ${hours} * * *`;
  }
  
  const job = cron.schedule(cronPattern, async () => {
    try {
      const channel = client.channels.cache.get(channelId);
      if (channel) {
        const message = await channel.send(`📝 **Task:** ${content}`);
        
        db.logSend('task', {
          source: 'cron',
          channel_id: channelId,
          user_id: userId,
          content: `📝 **Task:** ${content}`,
          status: 'sent',
          message_id: message.id,
          ref_id: id
        });
      }
    } catch (error) {
      console.error('Error sending task:', error);
      
      db.logSend('task', {
        source: 'cron',
        channel_id: channelId,
        user_id: userId,
        content: `📝 **Task:** ${content}`,
        status: 'failed',
        error: error.message,
        ref_id: id
      });
    }
  }, { scheduled: false });
  
  cronJobs.set(`task_${id}`, job);
  job.start();
  
  const schedule = days ? `on days ${days}` : 'daily';
  console.log(`Scheduled task ${id} for ${time} ${schedule}`);
}

// Bot event handlers
client.once('ready', async () => {
  console.log(`✅ Bot is online as ${client.user.tag}`);
  
  await registerSlashCommands();
  await loadScheduledItems();
  
  db.logActivity('activity:bot_started', {
    source: 'discord_bot'
  });
});

async function registerSlashCommands() {
  const commands = [
    {
      name: 'add-task',
      description: 'Add a recurring task',
      options: [
        {
          name: 'content',
          type: 3,
          description: 'Task description',
          required: true,
        },
        {
          name: 'time',
          type: 3,
          description: 'Time in HH:MM format (24-hour)',
          required: true,
        },
        {
          name: 'days',
          type: 3,
          description: 'Days of week (0=Sun,1=Mon...6=Sat) comma-separated, empty for daily',
          required: false,
        },
      ],
    },
    {
      name: 'add-reminder',
      description: 'Add a daily reminder',
      options: [
        {
          name: 'content',
          type: 3,
          description: 'Reminder message',
          required: true,
        },
        {
          name: 'time',
          type: 3,
          description: 'Time in HH:MM format (24-hour)',
          required: true,
        },
      ],
    },
    {
      name: 'list-reminders',
      description: 'List your active reminders',
    },
    {
      name: 'delete-reminder',
      description: 'Delete a reminder by ID',
      options: [
        {
          name: 'id',
          type: 4,
          description: 'Reminder ID to delete',
          required: true,
        },
      ],
    },
    {
      name: 'delete-messages',
      description: 'Delete recent bot messages in this channel',
      options: [
        {
          name: 'count',
          type: 4,
          description: 'Number of messages to delete (default: 10, max: 50)',
          required: false,
        },
      ],
    },
  ];

  const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

  try {
    console.log('🔄 Registering slash commands...');
    
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID),
      { body: commands }
    );
    
    console.log('✅ Slash commands registered successfully');
  } catch (error) {
    console.error('❌ Error registering slash commands:', error);
  }
}

async function loadScheduledItems() {
  try {
    db.db.all('SELECT * FROM reminders', [], (err, reminders) => {
      if (err) {
        console.error('Error loading reminders:', err);
        return;
      }
      
      reminders.forEach(reminder => {
        scheduleReminder(
          reminder.id,
          reminder.content,
          reminder.channel_id,
          reminder.user_id,
          reminder.time
        );
      });
      
      console.log(`📅 Loaded ${reminders.length} reminders`);
    });
    
    db.db.all('SELECT * FROM tasks', [], (err, tasks) => {
      if (err) {
        console.error('Error loading tasks:', err);
        return;
      }
      
      tasks.forEach(task => {
        scheduleTask(
          task.id,
          task.content,
          task.channel_id,
          task.user_id,
          task.time,
          task.days
        );
      });
      
      console.log(`📝 Loaded ${tasks.length} tasks`);
    });
  } catch (error) {
    console.error('Error loading scheduled items:', error);
  }
}

// Slash command interaction handler
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  try {
    await interaction.deferReply({ flags: 64 });

    switch (commandName) {
      case 'add-task':
        await handleAddTask(interaction);
        break;
      case 'add-reminder':
        await handleAddReminder(interaction);
        break;
      case 'list-reminders':
        await handleListReminders(interaction);
        break;
      case 'delete-reminder':
        await handleDeleteReminder(interaction);
        break;
      case 'delete-messages':
        await handleDeleteMessages(interaction);
        break;
      default:
        await interaction.editReply({ content: 'Unknown command!' });
    }
  } catch (error) {
    console.error(`Error handling ${commandName}:`, error);
    
    const errorMessage = 'An error occurred while processing your command.';
    
    try {
      if (interaction.deferred) {
        await interaction.editReply({ content: errorMessage });
      } else {
        await interaction.reply({ content: errorMessage, flags: 64 });
      }
    } catch (replyError) {
      console.error('Error sending error response:', replyError);
    }

    db.logActivity('activity:command_error', {
      source: 'discord_slash',
      channel_id: interaction.channel?.id,
      user_id: interaction.user.id,
      status: 'failed',
      error: error.message,
      action: commandName
    });
  }
});

// Command handlers
async function handleAddTask(interaction) {
  const content = interaction.options.getString('content');
  const time = interaction.options.getString('time');
  const days = interaction.options.getString('days');

  const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
  if (!timeRegex.test(time)) {
    await interaction.editReply({
      content: '❌ Invalid time format. Please use HH:MM format (24-hour).'
    });
    return;
  }

  if (days) {
    const dayNumbers = days.split(',').map(d => d.trim());
    const validDays = dayNumbers.every(day => {
      const num = parseInt(day);
      return !isNaN(num) && num >= 0 && num <= 6;
    });

    if (!validDays) {
      await interaction.editReply({
        content: '❌ Invalid days format. Use comma-separated numbers 0-6 (0=Sunday, 1=Monday, etc.).'
      });
      return;
    }
  }

  try {
    const stmt = db.db.prepare(`
      INSERT INTO tasks (content, channel_id, user_id, time, days)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      content,
      interaction.channel.id,
      interaction.user.id,
      time,
      days || null
    );
    stmt.finalize();

    scheduleTask(result.lastID, content, interaction.channel.id, interaction.user.id, time, days);

    db.logActivity('activity:task_added', {
      source: 'discord_slash',
      channel_id: interaction.channel.id,
      user_id: interaction.user.id,
      status: 'success',
      ref_id: result.lastID,
      action: 'add_task'
    });

    const scheduleText = days ? `on days ${days}` : 'daily';
    await interaction.editReply({
      content: `✅ Task added! I'll remind you "${content}" at ${time} ${scheduleText}.`
    });

  } catch (error) {
    console.error('Error adding task:', error);
    
    db.logActivity('activity:task_add_failed', {
      source: 'discord_slash',
      channel_id: interaction.channel.id,
      user_id: interaction.user.id,
      status: 'failed',
      error: error.message,
      action: 'add_task'
    });

    await interaction.editReply({
      content: '❌ Failed to add task. Please try again.'
    });
  }
}

async function handleAddReminder(interaction) {
  const content = interaction.options.getString('content');
  const time = interaction.options.getString('time');

  const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
  if (!timeRegex.test(time)) {
    await interaction.editReply({
      content: '❌ Invalid time format. Please use HH:MM format (24-hour).'
    });
    return;
  }

  try {
    const stmt = db.db.prepare(`
      INSERT INTO reminders (content, channel_id, user_id, time)
      VALUES (?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      content,
      interaction.channel.id,
      interaction.user.id,
      time
    );
    stmt.finalize();

    scheduleReminder(result.lastID, content, interaction.channel.id, interaction.user.id, time);

    db.logActivity('activity:reminder_added', {
      source: 'discord_slash',
      channel_id: interaction.channel.id,
      user_id: interaction.user.id,
      status: 'success',
      ref_id: result.lastID,
      action: 'add_reminder'
    });

    await interaction.editReply({
      content: `✅ Daily reminder added! I'll remind you "${content}" at ${time} every day.`
    });

  } catch (error) {
    console.error('Error adding reminder:', error);
    
    db.logActivity('activity:reminder_add_failed', {
      source: 'discord_slash',
      channel_id: interaction.channel.id,
      user_id: interaction.user.id,
      status: 'failed',
      error: error.message,
      action: 'add_reminder'
    });

    await interaction.editReply({
      content: '❌ Failed to add reminder. Please try again.'
    });
  }
}

async function handleListReminders(interaction) {
  try {
    return new Promise((resolve, reject) => {
      db.db.all(`
        SELECT id, content, time, created_at
        FROM reminders 
        WHERE user_id = ? 
        ORDER BY time ASC
      `, [interaction.user.id], async (err, reminders) => {
        if (err) {
          console.error('Error getting user reminders:', err);
          
          db.logActivity('activity:list_reminders_failed', {
            source: 'discord_slash',
            channel_id: interaction.channel.id,
            user_id: interaction.user.id,
            status: 'failed',
            error: err.message,
            action: 'list_reminders'
          });

          await interaction.editReply({
            content: '❌ Failed to retrieve reminders.'
          });
          
          reject(err);
          return;
        }

        if (!reminders || reminders.length === 0) {
          await interaction.editReply({
            content: '📭 You have no active reminders.'
          });
          resolve();
          return;
        }

        let response = '📋 **Your Active Reminders:**\n\n';
        reminders.forEach(reminder => {
          const createdDate = new Date(reminder.created_at).toLocaleDateString();
          response += `**ID ${reminder.id}:** ${reminder.content}\n`;
          response += `⏰ Time: ${reminder.time} daily\n`;
          response += `📅 Created: ${createdDate}\n\n`;
        });

        response += `Use \`/delete-reminder id:<ID>\` to delete a reminder.`;

        db.logActivity('activity:reminders_listed', {
          source: 'discord_slash',
          channel_id: interaction.channel.id,
          user_id: interaction.user.id,
          status: 'success',
          action: 'list_reminders'
        });

        await interaction.editReply({ content: response });
        resolve();
      });
    });

  } catch (error) {
    console.error('Error listing reminders:', error);
    
    db.logActivity('activity:list_reminders_failed', {
      source: 'discord_slash',
      channel_id: interaction.channel.id,
      user_id: interaction.user.id,
      status: 'failed',
      error: error.message,
      action: 'list_reminders'
    });

    await interaction.editReply({
      content: '❌ Failed to retrieve reminders.'
    });
  }
}

async function handleDeleteReminder(interaction) {
  const reminderId = interaction.options.getInteger('id');

  try {
    const checkStmt = db.db.prepare(`
      SELECT id, content FROM reminders WHERE id = ? AND user_id = ?
    `);
    
    const reminder = checkStmt.get(reminderId, interaction.user.id);
    checkStmt.finalize();

    if (!reminder) {
      await interaction.editReply({
        content: '❌ Reminder not found or you don\'t have permission to delete it.'
      });
      return;
    }

    const deleteStmt = db.db.prepare(`DELETE FROM reminders WHERE id = ?`);
    deleteStmt.run(reminderId);
    deleteStmt.finalize();

    const cronJobKey = `reminder_${reminderId}`;
    if (cronJobs.has(cronJobKey)) {
      cronJobs.get(cronJobKey).stop();
      cronJobs.delete(cronJobKey);
    }

    db.logActivity('activity:reminder_deleted', {
      source: 'discord_slash',
      channel_id: interaction.channel.id,
      user_id: interaction.user.id,
      status: 'success',
      ref_id: reminderId,
      action: 'delete_reminder'
    });

    await interaction.editReply({
      content: `✅ Reminder "${reminder.content}" (ID: ${reminderId}) has been deleted.`
    });

  } catch (error) {
    console.error('Error deleting reminder:', error);
    
    db.logActivity('activity:reminder_delete_failed', {
      source: 'discord_slash',
      channel_id: interaction.channel.id,
      user_id: interaction.user.id,
      status: 'failed',
      error: error.message,
      ref_id: reminderId,
      action: 'delete_reminder'
    });

    await interaction.editReply({
      content: '❌ Failed to delete reminder.'
    });
  }
}

async function handleDeleteMessages(interaction) {
  const count = interaction.options.getInteger('count') || 10;
  
  if (count < 1 || count > 50) {
    await interaction.editReply({
      content: '❌ Count must be between 1 and 50.'
    });
    return;
  }

  try {
    const messages = await interaction.channel.messages.fetch({ limit: 100 });
    const botMessages = messages.filter(msg => msg.author.id === client.user.id);
    const messagesToDelete = Array.from(botMessages.values()).slice(0, count);
    
    if (messagesToDelete.length === 0) {
      await interaction.editReply({
        content: '📭 No bot messages found to delete.'
      });
      return;
    }

    let deleted = 0;
    for (const message of messagesToDelete) {
      try {
        await message.delete();
        deleted++;
      } catch (error) {
        console.error('Error deleting message:', error);
      }
    }

    db.logActivity('activity:messages_deleted', {
      source: 'discord_slash',
      channel_id: interaction.channel.id,
      user_id: interaction.user.id,
      status: 'success',
      action: 'delete_messages',
      emoji: '🗑️'
    });

    await interaction.editReply({
      content: `🗑️ Deleted ${deleted} bot message(s) from this channel.`
    });

  } catch (error) {
    console.error('Error deleting messages:', error);
    
    db.logActivity('activity:delete_messages_failed', {
      source: 'discord_slash',
      channel_id: interaction.channel.id,
      user_id: interaction.user.id,
      status: 'failed',
      error: error.message,
      action: 'delete_messages'
    });

    await interaction.editReply({
      content: '❌ Failed to delete messages.'
    });
  }
}

// Start the bot
async function startBot() {
  try {
    await db.connect();
    console.log('✅ Database connected');
    
    await client.login(process.env.BOT_TOKEN);
    console.log('✅ Discord bot logged in');
    
    const port = process.env.BOT_HTTP_PORT || 3001;
    app.listen(port, () => {
      console.log(`✅ HTTP API server running on port ${port}`);
    });
    
  } catch (error) {
    console.error('❌ Error starting bot:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down bot...');
  
  cronJobs.forEach(job => job.stop());
  await db.close();
  client.destroy();
  
  process.exit(0);
});

// Start the bot
startBot();