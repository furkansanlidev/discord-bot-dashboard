import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const token = request.headers.get('x-logs-token')
  
  if (token !== process.env.LOGS_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { maxAge = 30 } = await request.json()
    
    // Call the bot's rotation endpoint (we'll add this to the bot)
    const botResponse = await fetch(`${process.env.BOT_HTTP_BASE || 'http://localhost:3001'}/rotate-logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-logs-token': process.env.LOGS_TOKEN!,
      },
      body: JSON.stringify({ maxAge }),
    })

    if (!botResponse.ok) {
      const errorText = await botResponse.text()
      throw new Error(`Bot API error: ${botResponse.status} - ${errorText}`)
    }

    const result = await botResponse.json()

    return NextResponse.json({
      message: 'Log rotation completed',
      archivedRecords: result.archivedRecords
    })
  } catch (error) {
    console.error('Error rotating logs:', error)
    return NextResponse.json(
      { error: 'Failed to rotate logs' },
      { status: 500 }
    )
  }
}