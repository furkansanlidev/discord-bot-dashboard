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

export async function DELETE(request: NextRequest) {
  const token = request.headers.get('x-logs-token')
  
  if (token !== process.env.LOGS_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let db: sqlite3.Database | null = null

  try {
    db = await openDatabase()

    // Clear both log tables
    await new Promise<void>((resolve, reject) => {
      db!.run('DELETE FROM send_logs', (err) => {
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      })
    })

    await new Promise<void>((resolve, reject) => {
      db!.run('DELETE FROM activity_logs', (err) => {
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      })
    })

    // Reset auto-increment counters
    await new Promise<void>((resolve, reject) => {
      db!.run('DELETE FROM sqlite_sequence WHERE name IN ("send_logs", "activity_logs")', (err) => {
        if (err) {
          // This is not critical, just log the error
          console.warn('Warning: Could not reset auto-increment counters:', err)
        }
        resolve()
      })
    })

    return NextResponse.json({ message: 'All logs cleared successfully' })
  } catch (error) {
    console.error('Error clearing logs:', error)
    return NextResponse.json(
      { error: 'Failed to clear logs' },
      { status: 500 }
    )
  } finally {
    if (db) {
      await closeDatabase(db)
    }
  }
}