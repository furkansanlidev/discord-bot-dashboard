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

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const token = request.headers.get('x-logs-token')
  
  if (token !== process.env.LOGS_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const logId = parseInt(params.id)
  if (isNaN(logId)) {
    return NextResponse.json({ error: 'Invalid log ID' }, { status: 400 })
  }

  let db: sqlite3.Database | null = null

  try {
    db = await openDatabase()

    // Get the failed log entry
    const log = await new Promise<any>((resolve, reject) => {
      db!.get(
        'SELECT * FROM send_logs WHERE id = ? AND status = "failed"',
        [logId],
        (err, row) => {
          if (err) {
            reject(err)
          } else {
            resolve(row)
          }
        }
      )
    })

    if (!log) {
      return NextResponse.json(
        { error: 'Failed log entry not found' },
        { status: 404 }
      )
    }

    // Determine the retry action based on log kind
    let botEndpoint = ''
    let payload: any = {}

    if (log.kind === 'reminder') {
      // Retry reminder
      if (!log.ref_id) {
        return NextResponse.json(
          { error: 'Cannot retry: missing reference ID' },
          { status: 400 }
        )
      }

      // Get reminder details
      const reminder = await new Promise<any>((resolve, reject) => {
        db!.get(
          'SELECT * FROM reminders WHERE id = ?',
          [log.ref_id],
          (err, row) => {
            if (err) {
              reject(err)
            } else {
              resolve(row)
            }
          }
        )
      })

      if (!reminder) {
        return NextResponse.json(
          { error: 'Original reminder not found' },
          { status: 404 }
        )
      }

      botEndpoint = '/send-once'
      payload = {
        content: `⏰ **Reminder:** ${reminder.content}`,
        channel_id: reminder.channel_id
      }
    } else if (log.kind === 'task') {
      // Retry task
      if (!log.ref_id) {
        return NextResponse.json(
          { error: 'Cannot retry: missing reference ID' },
          { status: 400 }
        )
      }

      // Get task details
      const task = await new Promise<any>((resolve, reject) => {
        db!.get(
          'SELECT * FROM tasks WHERE id = ?',
          [log.ref_id],
          (err, row) => {
            if (err) {
              reject(err)
            } else {
              resolve(row)
            }
          }
        )
      })

      if (!task) {
        return NextResponse.json(
          { error: 'Original task not found' },
          { status: 404 }
        )
      }

      botEndpoint = '/send-once'
      payload = {
        content: `📝 **Task:** ${task.content}`,
        channel_id: task.channel_id
      }
    } else {
      return NextResponse.json(
        { error: 'Cannot retry this type of log entry' },
        { status: 400 }
      )
    }

    // Call the bot API to retry
    const botResponse = await fetch(`${process.env.BOT_HTTP_BASE || 'http://localhost:3001'}${botEndpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-logs-token': process.env.LOGS_TOKEN!,
      },
      body: JSON.stringify(payload),
    })

    if (!botResponse.ok) {
      const errorText = await botResponse.text()
      throw new Error(`Bot API error: ${botResponse.status} - ${errorText}`)
    }

    const result = await botResponse.json()

    return NextResponse.json({
      message: 'Retry sent successfully',
      result
    })
  } catch (error) {
    console.error('Error retrying log:', error)
    return NextResponse.json(
      { error: 'Failed to retry log entry' },
      { status: 500 }
    )
  } finally {
    if (db) {
      await closeDatabase(db)
    }
  }
}