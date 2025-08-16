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
  const { searchParams } = new URL(request.url)
  const kind = searchParams.get('kind') || ''
  const status = searchParams.get('status') || ''
  const channel_id = searchParams.get('channel_id') || ''
  const q = searchParams.get('q') || ''
  const cursor = searchParams.get('cursor') || ''
  const limit = parseInt(searchParams.get('limit') || '50')

  let db: sqlite3.Database | null = null

  try {
    db = await openDatabase()

    // Fetch send_logs and activity_logs separately, then combine them
    const sendLogs = await new Promise<any[]>((resolve, reject) => {
      let sendQuery = `
        SELECT 
          id,
          kind,
          source,
          channel_id,
          user_id,
          content,
          status,
          error,
          message_id,
          ref_id,
          sent_at as timestamp,
          'send' as log_type
        FROM send_logs
      `
      
      const conditions: string[] = []
      const params: any[] = []

      if (kind) {
        conditions.push('kind LIKE ?')
        params.push(`%${kind}%`)
      }
      if (status) {
        conditions.push('status = ?')
        params.push(status)
      }
      if (channel_id) {
        conditions.push('channel_id = ?')
        params.push(channel_id)
      }
      if (q) {
        conditions.push('(content LIKE ? OR kind LIKE ? OR error LIKE ?)')
        params.push(`%${q}%`, `%${q}%`, `%${q}%`)
      }

      if (conditions.length > 0) {
        sendQuery += ' WHERE ' + conditions.join(' AND ')
      }

      if (cursor) {
        const [timestamp, id] = cursor.split('_')
        if (conditions.length > 0) {
          sendQuery += ` AND ((sent_at < ?) OR (sent_at = ? AND id < ?))`
        } else {
          sendQuery += ` WHERE ((sent_at < ?) OR (sent_at = ? AND id < ?))`
        }
        params.push(timestamp, timestamp, parseInt(id))
      }

      sendQuery += ' ORDER BY sent_at DESC, id DESC'

      db!.all(sendQuery, params, (err, rows) => {
        if (err) {
          reject(err)
        } else {
          resolve(rows || [])
        }
      })
    })

    const activityLogs = await new Promise<any[]>((resolve, reject) => {
      let activityQuery = `
        SELECT 
          id,
          kind,
          source,
          channel_id,
          user_id,
          '' as content,
          status,
          error,
          message_id,
          ref_id,
          created_at as timestamp,
          'activity' as log_type
        FROM activity_logs
      `
      
      const conditions: string[] = []
      const params: any[] = []

      if (kind) {
        conditions.push('kind LIKE ?')
        params.push(`%${kind}%`)
      }
      if (status) {
        conditions.push('status = ?')
        params.push(status)
      }
      if (channel_id) {
        conditions.push('channel_id = ?')
        params.push(channel_id)
      }
      if (q) {
        conditions.push('(kind LIKE ? OR error LIKE ?)')
        params.push(`%${q}%`, `%${q}%`)
      }

      if (conditions.length > 0) {
        activityQuery += ' WHERE ' + conditions.join(' AND ')
      }

      if (cursor) {
        const [timestamp, id] = cursor.split('_')
        if (conditions.length > 0) {
          activityQuery += ` AND ((created_at < ?) OR (created_at = ? AND id < ?))`
        } else {
          activityQuery += ` WHERE ((created_at < ?) OR (created_at = ? AND id < ?))`
        }
        params.push(timestamp, timestamp, parseInt(id))
      }

      activityQuery += ' ORDER BY created_at DESC, id DESC'

      db!.all(activityQuery, params, (err, rows) => {
        if (err) {
          reject(err)
        } else {
          resolve(rows || [])
        }
      })
    })

    // Combine and sort all logs
    const allLogs = [...sendLogs, ...activityLogs]
    
    // Sort by timestamp descending, then by id descending
    allLogs.sort((a, b) => {
      const timestampA = new Date(a.timestamp).getTime()
      const timestampB = new Date(b.timestamp).getTime()
      
      if (timestampB !== timestampA) {
        return timestampB - timestampA
      }
      
      return b.id - a.id
    })

    // Apply limit and pagination
    const logs = allLogs.slice(0, limit + 1)
    const hasMore = logs.length > limit
    
    if (hasMore) {
      logs.pop() // Remove the extra item
    }

    // Generate next cursor
    let nextCursor = null
    if (hasMore && logs.length > 0) {
      const lastItem = logs[logs.length - 1]
      nextCursor = `${lastItem.timestamp}_${lastItem.id}`
    }

    return NextResponse.json({
      logs,
      hasMore,
      nextCursor,
    })
  } catch (error) {
    console.error('Error fetching logs:', error)
    return NextResponse.json(
      { error: 'Failed to fetch logs' },
      { status: 500 }
    )
  } finally {
    if (db) {
      await closeDatabase(db)
    }
  }
}

export async function POST(request: NextRequest) {
  const token = request.headers.get('x-logs-token')
  
  if (token !== process.env.LOGS_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let db: sqlite3.Database | null = null

  try {
    const body = await request.json()
    const { kind, source, channel_id, user_id, status, error, message_id, ref_id, action, emoji } = body

    db = await openDatabase()

    const result = await new Promise<any>((resolve, reject) => {
      const stmt = db!.prepare(`
        INSERT INTO activity_logs (kind, source, channel_id, user_id, status, error, message_id, ref_id, action, emoji)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      
      stmt.run(
        kind,
        source || null,
        channel_id || null,
        user_id || null,
        status || 'success',
        error || null,
        message_id || null,
        ref_id || null,
        action || null,
        emoji || null,
        function(err) {
          if (err) {
            reject(err)
          } else {
            resolve({ id: this.lastID })
          }
        }
      )
      
      stmt.finalize()
    })

    return NextResponse.json({ message: 'Log created', id: result.id })
  } catch (error) {
    console.error('Error creating log:', error)
    return NextResponse.json(
      { error: 'Failed to create log' },
      { status: 500 }
    )
  } finally {
    if (db) {
      await closeDatabase(db)
    }
  }
}