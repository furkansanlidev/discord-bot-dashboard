import { NextRequest, NextResponse } from 'next/server'
import sqlite3 from 'sqlite3'
import path from 'path'

const dbPath = path.resolve(process.cwd(), '../data.db')

function openDatabase(): Promise<sqlite3.Database> {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        reject(err)
      } else {
        resolve(db)
      }
    })
  })
}

function closeDatabase(db: sqlite3.Database): Promise<void> {
  return new Promise((resolve) => {
    db.close((err) => {
      if (err) {
        console.error('Error closing database:', err)
      }
      resolve()
    })
  })
}

export async function GET(request: NextRequest) {
  let db: sqlite3.Database | null = null

  try {
    db = await openDatabase()

    // Get comprehensive statistics
    const stats = await new Promise<any>((resolve, reject) => {
      const result: any = {}
      
      db!.serialize(() => {
        // Active tasks and reminders
        db!.get('SELECT COUNT(*) as count FROM tasks WHERE active = 1', [], (err, row) => {
          if (err) { reject(err); return; }
          result.activeTasks = row.count;
          
          db!.get('SELECT COUNT(*) as count FROM reminders WHERE active = 1', [], (err, row) => {
            if (err) { reject(err); return; }
            result.activeReminders = row.count;
            
            // Log counts
            db!.get('SELECT COUNT(*) as count FROM send_logs', [], (err, row) => {
              if (err) { reject(err); return; }
              result.totalSendLogs = row.count;
              
              db!.get('SELECT COUNT(*) as count FROM activity_logs', [], (err, row) => {
                if (err) { reject(err); return; }
                result.totalActivityLogs = row.count;
                
                // Failed logs
                db!.get('SELECT COUNT(*) as count FROM send_logs WHERE status = "failed"', [], (err, row) => {
                  if (err) { reject(err); return; }
                  result.failedSends = row.count;
                  
                  // Recent activity (last 24 hours)
                  const yesterday = new Date()
                  yesterday.setDate(yesterday.getDate() - 1)
                  const yesterdayString = yesterday.toISOString()
                  
                  db!.get(
                    'SELECT COUNT(*) as count FROM activity_logs WHERE created_at > ?',
                    [yesterdayString],
                    (err, row) => {
                      if (err) { reject(err); return; }
                      result.recentActivity = row.count;
                      
                      // Success rate calculation
                      db!.get(
                        'SELECT COUNT(*) as total, SUM(CASE WHEN status = "success" THEN 1 ELSE 0 END) as successful FROM send_logs',
                        [],
                        (err, row) => {
                          if (err) { reject(err); return; }
                          result.totalAttempts = row.total;
                          result.successfulAttempts = row.successful;
                          result.successRate = row.total > 0 ? ((row.successful / row.total) * 100).toFixed(1) : '100';
                          
                          // Top channels by activity
                          db!.all(
                            `SELECT channel_id, COUNT(*) as count 
                             FROM (
                               SELECT channel_id FROM send_logs WHERE channel_id IS NOT NULL
                               UNION ALL
                               SELECT channel_id FROM activity_logs WHERE channel_id IS NOT NULL
                             ) 
                             GROUP BY channel_id 
                             ORDER BY count DESC 
                             LIMIT 5`,
                            [],
                            (err, rows) => {
                              if (err) { reject(err); return; }
                              result.topChannels = rows;
                              
                              // Recent log rotation info
                              db!.get(
                                'SELECT * FROM log_rotation ORDER BY rotated_at DESC LIMIT 1',
                                [],
                                (err, row) => {
                                  if (err && !err.message.includes('no such table')) {
                                    reject(err);
                                    return;
                                  }
                                  result.lastRotation = row || null;
                                  
                                  resolve(result);
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
            });
          });
        });
      });
    });

    return NextResponse.json(stats)
  } catch (error) {
    console.error('Error fetching stats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch statistics' },
      { status: 500 }
    )
  } finally {
    if (db) {
      await closeDatabase(db)
    }
  }
}