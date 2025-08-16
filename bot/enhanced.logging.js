// Enhanced logging system with Discord channel routing
// bot/enhanced-logging.js

// Log categories configuration
const LOG_CATEGORIES = {
  REMINDERS: {
    name: 'reminders',
    emoji: '⏰',
    description: 'Reminder activities (added, triggered, deleted)',
    subcategories: ['reminder_added', 'reminder_triggered', 'reminder_deleted', 'reminder_failed']
  },
  TASKS: {
    name: 'tasks', 
    emoji: '📝',
    description: 'Task activities (added, triggered, completed)',
    subcategories: ['task_added', 'task_triggered', 'task_completed', 'task_failed']
  },
  REACTIONS: {
    name: 'reactions',
    emoji: '⚡',
    description: 'Bot reaction activities (added, removed, errors)',
    subcategories: ['reaction_added', 'reaction_removed', 'reaction_failed']
  },
  COMMANDS: {
    name: 'commands',
    emoji: '🎯',
    description: 'Slash command usage and errors',
    subcategories: ['command_executed', 'command_failed', 'command_error']
  },
  SYSTEM: {
    name: 'system',
    emoji: '⚙️',
    description: 'System events (startup, shutdown, errors)',
    subcategories: ['bot_started', 'bot_stopped', 'database_connected', 'logs_rotated', 'log_channel_configured']
  },
  MESSAGES: {
    name: 'messages',
    emoji: '💬',
    description: 'Message sending and delivery',
    subcategories: ['message_sent', 'message_failed', 'bulk_delete']
  }
};

// Enhanced logging class
class EnhancedLogging {
  constructor(db, client) {
    this.db = db;
    this.client = client;
  }

  // Initialize enhanced logging tables
  async initEnhancedTables() {
    const enhancedTables = [
      // Log channel configuration table
      `CREATE TABLE IF NOT EXISTS log_channels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        category TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        enabled BOOLEAN DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(guild_id, category)
      )`,
      
      // Enhanced logs with categories
      `CREATE TABLE IF NOT EXISTS enhanced_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        subcategory TEXT NOT NULL,
        level TEXT NOT NULL DEFAULT 'info',
        title TEXT NOT NULL,
        description TEXT,
        guild_id TEXT,
        channel_id TEXT,
        user_id TEXT,
        reference_id INTEGER,
        metadata TEXT,
        dashboard_sent BOOLEAN DEFAULT 1,
        discord_sent BOOLEAN DEFAULT 0,
        discord_message_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`
    ];

    const enhancedIndexes = [
      `CREATE INDEX IF NOT EXISTS idx_enhanced_logs_category ON enhanced_logs(category, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_enhanced_logs_guild ON enhanced_logs(guild_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_log_channels_guild_category ON log_channels(guild_id, category)`,
    ];
    
    for (const query of enhancedTables) {
      await this.executeQuery(query);
    }
    
    for (const query of enhancedIndexes) {
      await this.executeQuery(query);
    }
    
    console.log('✅ Enhanced logging tables initialized');
  }

  // Configure log channel for a category
  async setLogChannel(guildId, category, channelId, enabled = true) {
    const stmt = this.db.db.prepare(`
      INSERT OR REPLACE INTO log_channels (guild_id, category, channel_id, enabled, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    stmt.run(guildId, category, channelId, enabled ? 1 : 0, new Date().toISOString());
    stmt.finalize();
    
    console.log(`📝 Log channel configured: ${category} -> ${channelId} (${enabled ? 'enabled' : 'disabled'})`);
  }

  // Get log channel configuration for a guild
  async getLogChannels(guildId) {
    return new Promise((resolve, reject) => {
      this.db.db.all(`
        SELECT category, channel_id, enabled 
        FROM log_channels 
        WHERE guild_id = ?
      `, [guildId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  // Enhanced log method with Discord routing
  async logEnhanced(category, subcategory, data = {}) {
    const logData = {
      category: category,
      subcategory: subcategory,
      level: data.level || 'info',
      title: data.title || this.generateTitle(category, subcategory),
      description: data.description || '',
      guild_id: data.guild_id || process.env.GUILD_ID,
      channel_id: data.channel_id || null,
      user_id: data.user_id || null,
      reference_id: data.reference_id || null,
      metadata: data.metadata ? JSON.stringify(data.metadata) : null
    };

    // Insert into enhanced logs table
    const stmt = this.db.db.prepare(`
      INSERT INTO enhanced_logs (
        category, subcategory, level, title, description, 
        guild_id, channel_id, user_id, reference_id, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      logData.category, logData.subcategory, logData.level,
      logData.title, logData.description, logData.guild_id,
      logData.channel_id, logData.user_id, logData.reference_id,
      logData.metadata
    );
    stmt.finalize();

    const logId = result.lastID;

    // Send to Discord if configured
    if (logData.guild_id) {
      await this.sendToDiscord(logId, logData);
    }

    // Also log to original tables for backward compatibility
    this.db.logActivity(`${category}:${subcategory}`, {
      source: data.source || 'enhanced_logging',
      channel_id: logData.channel_id,
      user_id: logData.user_id,
      status: logData.level === 'error' ? 'failed' : 'success',
      error: logData.level === 'error' ? logData.description : null,
      ref_id: logData.reference_id
    });

    return logId;
  }

  // Send log to configured Discord channel
  async sendToDiscord(logId, logData) {
    try {
      // Get configured channel for this category
      const channels = await this.getLogChannels(logData.guild_id);
      const config = channels.find(c => c.category === logData.category && c.enabled);
      
      if (!config) {
        return; // No channel configured for this category
      }

      const channel = this.client.channels.cache.get(config.channel_id);
      if (!channel) {
        console.warn(`Log channel ${config.channel_id} not found for category ${logData.category}`);
        return;
      }

      const embed = this.createLogEmbed(logData);
      const message = await channel.send({ embeds: [embed] });

      // Update log record with Discord message info
      const updateStmt = this.db.db.prepare(`
        UPDATE enhanced_logs 
        SET discord_sent = 1, discord_message_id = ? 
        WHERE id = ?
      `);
      updateStmt.run(message.id, logId);
      updateStmt.finalize();

    } catch (error) {
      console.error('Error sending log to Discord:', error);
      
      // Mark as failed
      const updateStmt = this.db.db.prepare(`
        UPDATE enhanced_logs 
        SET discord_sent = 0 
        WHERE id = ?
      `);
      updateStmt.run(logId);
      updateStmt.finalize();
    }
  }

  // Create Discord embed for log
  createLogEmbed(logData) {
    const categoryConfig = Object.values(LOG_CATEGORIES).find(c => c.name === logData.category);
    const emoji = categoryConfig ? categoryConfig.emoji : '📋';
    
    let color;
    switch (logData.level) {
      case 'error':
        color = 0xff4757; // Red
        break;
      case 'warn':
        color = 0xffa502; // Orange  
        break;
      case 'success':
        color = 0x2ed573; // Green
        break;
      default:
        color = 0x5352ed; // Blue
    }

    const embed = {
      color: color,
      title: `${emoji} ${logData.title}`,
      timestamp: new Date().toISOString(),
      fields: []
    };

    if (logData.description) {
      embed.description = logData.description;
    }

    // Add metadata fields
    if (logData.user_id) {
      embed.fields.push({
        name: '👤 User',
        value: `<@${logData.user_id}>`,
        inline: true
      });
    }

    if (logData.channel_id) {
      embed.fields.push({
        name: '📍 Channel',
        value: `<#${logData.channel_id}>`,
        inline: true
      });
    }

    if (logData.reference_id) {
      embed.fields.push({
        name: '🔗 Reference ID',
        value: logData.reference_id.toString(),
        inline: true
      });
    }

    if (logData.metadata) {
      try {
        const metadata = JSON.parse(logData.metadata);
        const metadataText = Object.entries(metadata)
          .map(([key, value]) => `**${key}:** ${value}`)
          .join('\n');
        
        if (metadataText.length < 1024) {
          embed.fields.push({
            name: '📊 Details',
            value: metadataText,
            inline: false
          });
        }
      } catch (e) {
        // Ignore metadata parsing errors
      }
    }

    embed.footer = {
      text: `${logData.category} • ${logData.subcategory}`
    };

    return embed;
  }

  // Generate title from category and subcategory
  generateTitle(category, subcategory) {
    const titles = {
      reminders: {
        reminder_added: 'Reminder Created',
        reminder_triggered: 'Reminder Sent',
        reminder_deleted: 'Reminder Deleted',
        reminder_failed: 'Reminder Failed'
      },
      tasks: {
        task_added: 'Task Created',
        task_triggered: 'Task Sent', 
        task_completed: 'Task Completed',
        task_failed: 'Task Failed'
      },
      reactions: {
        reaction_added: 'Reaction Added',
        reaction_removed: 'Reaction Removed',
        reaction_failed: 'Reaction Failed'
      },
      commands: {
        command_executed: 'Command Executed',
        command_failed: 'Command Failed',
        command_error: 'Command Error'
      },
      system: {
        bot_started: 'Bot Started',
        bot_stopped: 'Bot Stopped',
        database_connected: 'Database Connected',
        logs_rotated: 'Logs Rotated',
        log_channel_configured: 'Log Channel Configured'
      },
      messages: {
        message_sent: 'Message Sent',
        message_failed: 'Message Failed',
        bulk_delete: 'Messages Deleted'
      }
    };

    return titles[category]?.[subcategory] || `${category} ${subcategory}`;
  }

  // Helper method for async query execution
  executeQuery(query, params = []) {
    return new Promise((resolve, reject) => {
      this.db.db.run(query, params, function(err) {
        if (err) reject(err);
        else resolve(this);
      });
    });
  }

  // Get enhanced logs with filtering (for dashboard)
  async getEnhancedLogs(filters = {}) {
    let query = `
      SELECT * FROM enhanced_logs 
      WHERE 1=1
    `;
    const params = [];

    if (filters.category) {
      query += ` AND category = ?`;
      params.push(filters.category);
    }

    if (filters.guild_id) {
      query += ` AND guild_id = ?`;
      params.push(filters.guild_id);
    }

    if (filters.level) {
      query += ` AND level = ?`;
      params.push(filters.level);
    }

    if (filters.since) {
      query += ` AND created_at >= ?`;
      params.push(filters.since);
    }

    query += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(filters.limit || 100);

    return new Promise((resolve, reject) => {
      this.db.db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }
}

// Export the enhanced logging class and constants
module.exports = {
  EnhancedLogging,
  LOG_CATEGORIES
};