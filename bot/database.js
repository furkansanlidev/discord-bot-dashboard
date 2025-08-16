const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class Database {
  constructor(dbPath) {
    this.dbPath = path.resolve(dbPath);
    this.db = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          reject(err);
        } else {
          console.log(`Connected to SQLite database at ${this.dbPath}`);
          this.enableWALMode()
            .then(() => this.initTables())
            .then(() => this.optimizeDatabase())
            .then(resolve)
            .catch(reject);
        }
      });
    });
  }

  enableWALMode() {
    return new Promise((resolve, reject) => {
      // Enable WAL mode for better concurrent access
      this.db.run('PRAGMA journal_mode=WAL;', (err) => {
        if (err) {
          console.warn('Could not enable WAL mode:', err);
          resolve(); // Continue anyway
        } else {
          console.log('✅ WAL mode enabled');
          
          // Additional performance settings
          this.db.run('PRAGMA synchronous=NORMAL;', (err) => {
            if (err) console.warn('Could not set synchronous mode:', err);
          });
          
          this.db.run('PRAGMA cache_size=10000;', (err) => {
            if (err) console.warn('Could not set cache size:', err);
          });
          
          this.db.run('PRAGMA temp_store=memory;', (err) => {
            if (err) console.warn('Could not set temp store:', err);
          });
          
          resolve();
        }
      });
    });
  }

  initTables() {
    return new Promise((resolve, reject) => {
      // First, create all tables with original structure
      const tableQueries = [
        `CREATE TABLE IF NOT EXISTS tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          content TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          time TEXT NOT NULL,
          days TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`,
        
        `CREATE TABLE IF NOT EXISTS reminders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          content TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          time TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`,
        
        `CREATE TABLE IF NOT EXISTS send_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kind TEXT NOT NULL,
          source TEXT,
          channel_id TEXT,
          user_id TEXT,
          content TEXT,
          status TEXT NOT NULL,
          error TEXT,
          message_id TEXT,
          ref_id INTEGER,
          sent_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`,
        
        `CREATE TABLE IF NOT EXISTS activity_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kind TEXT NOT NULL,
          source TEXT,
          channel_id TEXT,
          user_id TEXT,
          status TEXT,
          error TEXT,
          message_id TEXT,
          ref_id INTEGER,
          action TEXT,
          emoji TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`,
        
        `CREATE TABLE IF NOT EXISTS completions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id INTEGER,
          reminder_id INTEGER,
          user_id TEXT,
          completed_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (task_id) REFERENCES tasks(id),
          FOREIGN KEY (reminder_id) REFERENCES reminders(id)
        )`,
        
        // Add log rotation table
        `CREATE TABLE IF NOT EXISTS log_rotation (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          table_name TEXT NOT NULL,
          rotated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          records_archived INTEGER DEFAULT 0
        )`
      ];

      // Execute table creation queries first
      this.executeQueriesSequentially(tableQueries)
        .then(() => {
          console.log('✅ Database tables created successfully');
          // Run migrations to add new columns
          return this.runMigrations();
        })
        .then(() => {
          console.log('✅ Database migrations completed');
          // Then execute index creation queries
          return this.executeQueriesSequentially(this.getIndexQueries());
        })
        .then(() => {
          console.log('✅ Database indexes created successfully');
          resolve();
        })
        .catch(reject);
    });
  }

  runMigrations() {
    return new Promise((resolve, reject) => {
      const migrations = [
        // Add active column to tasks if it doesn't exist
        {
          name: 'add_active_to_tasks',
          query: 'ALTER TABLE tasks ADD COLUMN active BOOLEAN DEFAULT 1'
        },
        // Add updated_at column to tasks if it doesn't exist
        {
          name: 'add_updated_at_to_tasks',
          query: 'ALTER TABLE tasks ADD COLUMN updated_at TEXT'
        },
        // Add active column to reminders if it doesn't exist
        {
          name: 'add_active_to_reminders',
          query: 'ALTER TABLE reminders ADD COLUMN active BOOLEAN DEFAULT 1'
        },
        // Add updated_at column to reminders if it doesn't exist
        {
          name: 'add_updated_at_to_reminders',
          query: 'ALTER TABLE reminders ADD COLUMN updated_at TEXT'
        },
        // Add retry_count to send_logs if it doesn't exist
        {
          name: 'add_retry_count_to_send_logs',
          query: 'ALTER TABLE send_logs ADD COLUMN retry_count INTEGER DEFAULT 0'
        },
        // Add metadata to activity_logs if it doesn't exist
        {
          name: 'add_metadata_to_activity_logs',
          query: 'ALTER TABLE activity_logs ADD COLUMN metadata TEXT'
        }
      ];

      this.executeMigrations(migrations, 0, () => {
        // After adding columns, populate updated_at with current timestamp for existing records
        this.populateUpdatedAtFields()
          .then(resolve)
          .catch(reject);
      }, reject);
    });
  }

  populateUpdatedAtFields() {
    return new Promise((resolve, reject) => {
      const now = new Date().toISOString();
      
      this.db.serialize(() => {
        // Update tasks table
        this.db.run(
          'UPDATE tasks SET updated_at = ? WHERE updated_at IS NULL',
          [now],
          (err) => {
            if (err) {
              console.warn('Could not populate tasks updated_at:', err);
            } else {
              console.log('✅ Populated tasks updated_at field');
            }
            
            // Update reminders table
            this.db.run(
              'UPDATE reminders SET updated_at = ? WHERE updated_at IS NULL',
              [now],
              (err) => {
                if (err) {
                  console.warn('Could not populate reminders updated_at:', err);
                } else {
                  console.log('✅ Populated reminders updated_at field');
                }
                resolve();
              }
            );
          }
        );
      });
    });
  }

  executeMigrations(migrations, index, resolve, reject) {
    if (index >= migrations.length) {
      resolve();
      return;
    }

    const migration = migrations[index];
    this.db.run(migration.query, (err) => {
      if (err) {
        // If the error is "duplicate column name", it's safe to ignore
        if (err.message.includes('duplicate column name')) {
          console.log(`Migration ${migration.name}: column already exists, skipping`);
        } else {
          console.error(`Migration ${migration.name} failed:`, err);
          reject(err);
          return;
        }
      } else {
        console.log(`✅ Migration ${migration.name}: completed`);
      }
      
      this.executeMigrations(migrations, index + 1, resolve, reject);
    });
  }

  getIndexQueries() {
    return [
      // Performance indexes
      `CREATE INDEX IF NOT EXISTS idx_send_logs_time ON send_logs(sent_at DESC, id DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_activity_logs_time ON activity_logs(created_at DESC, id DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_time ON tasks(time)`,
      `CREATE INDEX IF NOT EXISTS idx_reminders_time ON reminders(time)`,
      
      // Filtering indexes
      `CREATE INDEX IF NOT EXISTS idx_send_logs_status ON send_logs(status)`,
      `CREATE INDEX IF NOT EXISTS idx_send_logs_kind ON send_logs(kind)`,
      `CREATE INDEX IF NOT EXISTS idx_send_logs_channel ON send_logs(channel_id)`,
      `CREATE INDEX IF NOT EXISTS idx_activity_logs_status ON activity_logs(status)`,
      `CREATE INDEX IF NOT EXISTS idx_activity_logs_kind ON activity_logs(kind)`,
      `CREATE INDEX IF NOT EXISTS idx_activity_logs_channel ON activity_logs(channel_id)`,
      
      // User-specific indexes (only create these after migration)
      `CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_send_logs_user ON send_logs(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_activity_logs_user ON activity_logs(user_id)`,
      
      // Composite indexes for common queries
      `CREATE INDEX IF NOT EXISTS idx_send_logs_status_time ON send_logs(status, sent_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_activity_logs_kind_time ON activity_logs(kind, created_at DESC)`
    ];
  }

  optimizeDatabase() {
    return new Promise((resolve) => {
      // Analyze tables for better query planning
      this.db.run('ANALYZE;', (err) => {
        if (err) {
          console.warn('Could not analyze database:', err);
        } else {
          console.log('✅ Database analysis completed');
        }
        resolve();
      });
    });
  }

  executeQueriesSequentially(queries) {
    return new Promise((resolve, reject) => {
      let currentIndex = 0;

      const executeNext = () => {
        if (currentIndex >= queries.length) {
          resolve();
          return;
        }

        const query = queries[currentIndex];
        this.db.run(query, (err) => {
          if (err) {
            console.error(`Error executing query ${currentIndex}:`, err);
            console.error('Query was:', query);
            reject(err);
            return;
          }
          
          currentIndex++;
          executeNext();
        });
      };

      executeNext();
    });
  }

  // Enhanced logging methods with retry tracking
  logActivity(kind, data = {}) {
    const stmt = this.db.prepare(`
      INSERT INTO activity_logs (kind, source, channel_id, user_id, status, error, message_id, ref_id, action, emoji, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      kind,
      data.source || null,
      data.channel_id || null,
      data.user_id || null,
      data.status || 'success',
      data.error || null,
      data.message_id || null,
      data.ref_id || null,
      data.action || null,
      data.emoji || null,
      data.metadata ? JSON.stringify(data.metadata) : null,
      (err) => {
        if (err) {
          console.error('Error logging activity:', err);
        }
      }
    );
    
    stmt.finalize();
  }

  logSend(kind, data = {}) {
    const stmt = this.db.prepare(`
      INSERT INTO send_logs (kind, source, channel_id, user_id, content, status, error, message_id, ref_id, retry_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      kind,
      data.source || null,
      data.channel_id || null,
      data.user_id || null,
      data.content || null,
      data.status || 'success',
      data.error || null,
      data.message_id || null,
      data.ref_id || null,
      data.retry_count || 0,
      (err) => {
        if (err) {
          console.error('Error logging send:', err);
        }
      }
    );
    
    stmt.finalize();
  }

  // Log rotation method
  rotateLogs(maxAge = 30) {
    return new Promise((resolve, reject) => {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - maxAge);
      const cutoffString = cutoffDate.toISOString();

      // Archive old logs (you could backup to files here)
      this.db.serialize(() => {
        let archived = 0;

        // Count records to be archived
        this.db.get(
          'SELECT COUNT(*) as count FROM send_logs WHERE sent_at < ?',
          [cutoffString],
          (err, row) => {
            if (err) {
              reject(err);
              return;
            }
            
            const sendLogsCount = row.count;
            
            this.db.get(
              'SELECT COUNT(*) as count FROM activity_logs WHERE created_at < ?',
              [cutoffString],
              (err, row) => {
                if (err) {
                  reject(err);
                  return;
                }
                
                const activityLogsCount = row.count;
                archived = sendLogsCount + activityLogsCount;
                
                if (archived === 0) {
                  console.log('No logs to rotate');
                  resolve(0);
                  return;
                }

                // Delete old records
                this.db.run(
                  'DELETE FROM send_logs WHERE sent_at < ?',
                  [cutoffString],
                  (err) => {
                    if (err) {
                      reject(err);
                      return;
                    }

                    this.db.run(
                      'DELETE FROM activity_logs WHERE created_at < ?',
                      [cutoffString],
                      (err) => {
                        if (err) {
                          reject(err);
                          return;
                        }

                        // Log the rotation
                        this.db.run(
                          'INSERT INTO log_rotation (table_name, records_archived) VALUES (?, ?)',
                          ['logs_combined', archived],
                          (err) => {
                            if (err) {
                              console.warn('Could not log rotation:', err);
                            }

                            console.log(`✅ Log rotation completed: ${archived} records archived`);
                            
                            // Vacuum database to reclaim space
                            this.db.run('VACUUM;', (err) => {
                              if (err) {
                                console.warn('Could not vacuum database:', err);
                              } else {
                                console.log('✅ Database vacuumed');
                              }
                              resolve(archived);
                            });
                          }
                        );
                      }
                    );
                  }
                );
              }
            );
          }
        );
      });
    });
  }

  // Get database statistics  
  getStats() {
    return new Promise((resolve, reject) => {
      const stats = {};
      
      this.db.serialize(() => {
        // Check if active column exists, if not use all records
        this.db.get("PRAGMA table_info(tasks)", [], (err, row) => {
          const hasActiveColumn = row !== undefined;
          const tasksQuery = hasActiveColumn ? 
            'SELECT COUNT(*) as count FROM tasks WHERE active = 1' :
            'SELECT COUNT(*) as count FROM tasks';
          
          this.db.get(tasksQuery, [], (err, row) => {
            if (err) { reject(err); return; }
            stats.activeTasks = row.count;
            
            const remindersQuery = hasActiveColumn ?
              'SELECT COUNT(*) as count FROM reminders WHERE active = 1' :
              'SELECT COUNT(*) as count FROM reminders';
              
            this.db.get(remindersQuery, [], (err, row) => {
              if (err) { reject(err); return; }
              stats.activeReminders = row.count;
              
              this.db.get('SELECT COUNT(*) as count FROM send_logs', [], (err, row) => {
                if (err) { reject(err); return; }
                stats.sendLogs = row.count;
                
                this.db.get('SELECT COUNT(*) as count FROM activity_logs', [], (err, row) => {
                  if (err) { reject(err); return; }
                  stats.activityLogs = row.count;
                  
                  this.db.get('SELECT COUNT(*) as count FROM send_logs WHERE status = "failed"', [], (err, row) => {
                    if (err) { reject(err); return; }
                    stats.failedSends = row.count;
                    
                    resolve(stats);
                  });
                });
              });
            });
          });
        });
      });
    });
  }

  close() {
    return new Promise((resolve) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) {
            console.error('Error closing database:', err);
          } else {
            console.log('Database connection closed');
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

module.exports = Database;