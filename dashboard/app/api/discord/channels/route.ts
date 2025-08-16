import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const botToken = process.env.BOT_TOKEN
    const guildId = process.env.GUILD_ID

    if (!botToken || !guildId) {
      return NextResponse.json(
        { error: 'Missing bot token or guild ID' },
        { status: 500 }
      )
    }

    // Fetch channels from Discord API
    const response = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/channels`,
      {
        headers: {
          Authorization: `Bot ${botToken}`,
          'Content-Type': 'application/json',
        },
      }
    )

    if (!response.ok) {
      throw new Error(`Discord API error: ${response.status}`)
    }

    const channels = await response.json()
    
    // Filter for text channels only
    const textChannels = channels
      .filter((channel: any) => channel.type === 0) // Text channels
      .map((channel: any) => ({
        id: channel.id,
        name: channel.name,
        position: channel.position,
      }))
      .sort((a: any, b: any) => a.position - b.position)

    return NextResponse.json({ channels: textChannels })
  } catch (error) {
    console.error('Error fetching Discord channels:', error)
    return NextResponse.json(
      { error: 'Failed to fetch channels' },
      { status: 500 }
    )
  }
}