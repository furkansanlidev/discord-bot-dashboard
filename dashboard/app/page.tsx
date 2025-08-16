'use client'

import { useSession, signIn } from 'next-auth/react'
import { useEffect, useState } from 'react'

interface BotStatus {
  status: string
  uptime: number
  timestamp: string
}

interface Statistics {
  activeTasks: number
  activeReminders: number
  totalSendLogs: number
  totalActivityLogs: number
  failedSends: number
  recentActivity: number
  totalAttempts: number
  successfulAttempts: number
  successRate: string
  topChannels: Array<{ channel_id: string; count: number }>
  lastRotation: { rotated_at: string; records_archived: number } | null
}

export default function Home() {
  const { data: session, status } = useSession()
  const [botStatus, setBotStatus] = useState<BotStatus | null>(null)
  const [botError, setBotError] = useState<string | null>(null)
  const [stats, setStats] = useState<Statistics | null>(null)
  const [channels, setChannels] = useState<Array<{ id: string; name: string }>>([])
  const [refreshing, setRefreshing] = useState(false)

  const fetchBotStatus = async () => {
    try {
      const res = await fetch('http://localhost:3001/health', {
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
        },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setBotStatus(data)
      setBotError(null)
    } catch (err) {
      console.error('Bot status error:', err)
      setBotError('Bot is offline or unreachable')
      setBotStatus(null)
    }
  }

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/stats')
      if (res.ok) {
        const data = await res.json()
        setStats(data)
      }
    } catch (err) {
      console.error('Error fetching stats:', err)
    }
  }

  const fetchChannels = async () => {
    try {
      const res = await fetch('/api/discord/channels')
      if (res.ok) {
        const data = await res.json()
        setChannels(data.channels || [])
      }
    } catch (err) {
      console.error('Error fetching channels:', err)
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    await Promise.all([fetchBotStatus(), fetchStats(), fetchChannels()])
    setRefreshing(false)
  }

  const handleRotateLogs = async () => {
    if (!confirm('Rotate logs older than 30 days? This cannot be undone.')) {
      return
    }

    try {
      const res = await fetch('/api/logs/rotate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-logs-token': process.env.NEXT_PUBLIC_LOGS_TOKEN!,
        },
        body: JSON.stringify({ maxAge: 30 }),
      })

      if (res.ok) {
        const data = await res.json()
        alert(`Log rotation completed: ${data.archivedRecords} records archived`)
        handleRefresh()
      } else {
        const error = await res.json()
        alert(`Rotation failed: ${error.error}`)
      }
    } catch (error) {
      console.error('Error rotating logs:', error)
      alert('Failed to rotate logs')
    }
  }

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    
    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m`
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`
    } else {
      return `${minutes}m`
    }
  }

  const getChannelName = (channelId: string) => {
    const channel = channels.find(c => c.id === channelId)
    return channel ? `#${channel.name}` : `#${channelId.slice(-4)}`
  }

  useEffect(() => {
    if (session) {
      handleRefresh()
      // Auto-refresh every 30 seconds
      const interval = setInterval(handleRefresh, 30000)
      return () => clearInterval(interval)
    }
  }, [session])

  if (status === 'loading') {
    return (
      <div className="flex justify-center items-center min-h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="max-w-md mx-auto mt-16 animate-fade-in">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-soft dark:shadow-dark-soft p-8 border border-gray-200 dark:border-gray-700">
          <div className="text-center">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center mx-auto mb-6">
              <span className="text-white font-bold text-xl">DB</span>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">
              Discord Bot Dashboard
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mb-8">
              Sign in with Discord to manage your bot and view analytics
            </p>
            <button
              onClick={() => signIn('discord')}
              className="w-full bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white py-3 px-6 rounded-lg font-medium transition-all duration-200 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
            >
              Sign in with Discord
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
            Dashboard
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Welcome back, <span className="font-medium text-gray-900 dark:text-gray-100">{session.user?.name}</span>
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-400 text-white rounded-lg font-medium transition-all duration-200 transform hover:scale-105 disabled:scale-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
          >
            <svg className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
          <button
            onClick={handleRotateLogs}
            className="inline-flex items-center px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-medium transition-all duration-200 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Rotate Logs
          </button>
        </div>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Bot Status */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-soft dark:shadow-dark-soft p-6 border border-gray-200 dark:border-gray-700 hover:shadow-lg dark:hover:shadow-xl transition-all duration-200">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Bot Status</h3>
              {botError ? (
                <div className="space-y-2">
                  <div className="flex items-center text-red-500 dark:text-red-400">
                    <div className="w-2 h-2 bg-red-500 rounded-full mr-2 animate-pulse"></div>
                    <span className="font-semibold">Offline</span>
                  </div>
                  <p className="text-xs text-red-500 dark:text-red-400">{botError}</p>
                </div>
              ) : botStatus ? (
                <div className="space-y-2">
                  <div className="flex items-center text-green-500 dark:text-green-400">
                    <div className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></div>
                    <span className="font-semibold">Online</span>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    Uptime: {formatUptime(botStatus.uptime)}
                  </p>
                </div>
              ) : (
                <div className="text-gray-400 dark:text-gray-500">Checking...</div>
              )}
            </div>
            <div className="w-12 h-12 bg-gradient-to-br from-green-400 to-green-500 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Active Tasks */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-soft dark:shadow-dark-soft p-6 border border-gray-200 dark:border-gray-700 hover:shadow-lg dark:hover:shadow-xl transition-all duration-200">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Active Tasks</h3>
              <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">
                {stats?.activeTasks ?? '...'}
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400">Scheduled tasks</p>
            </div>
            <div className="w-12 h-12 bg-gradient-to-br from-blue-400 to-blue-500 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
          </div>
        </div>

        {/* Active Reminders */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-soft dark:shadow-dark-soft p-6 border border-gray-200 dark:border-gray-700 hover:shadow-lg dark:hover:shadow-xl transition-all duration-200">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Reminders</h3>
              <div className="text-3xl font-bold text-purple-600 dark:text-purple-400">
                {stats?.activeReminders ?? '...'}
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400">Daily reminders</p>
            </div>
            <div className="w-12 h-12 bg-gradient-to-br from-purple-400 to-purple-500 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Success Rate */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-soft dark:shadow-dark-soft p-6 border border-gray-200 dark:border-gray-700 hover:shadow-lg dark:hover:shadow-xl transition-all duration-200">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Success Rate</h3>
              <div className="text-3xl font-bold text-green-600 dark:text-green-400">
                {stats?.successRate ?? '...'}%
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                {stats?.successfulAttempts ?? 0} / {stats?.totalAttempts ?? 0} successful
              </p>
            </div>
            <div className="w-12 h-12 bg-gradient-to-br from-green-400 to-green-500 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Detailed Statistics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Log Statistics */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-soft dark:shadow-dark-soft p-6 border border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-6 flex items-center">
            <svg className="w-5 h-5 mr-2 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            Log Statistics
          </h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <span className="text-gray-600 dark:text-gray-400">Total Send Logs:</span>
              <span className="font-semibold text-gray-900 dark:text-gray-100">{stats?.totalSendLogs ?? 0}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <span className="text-gray-600 dark:text-gray-400">Activity Logs:</span>
              <span className="font-semibold text-gray-900 dark:text-gray-100">{stats?.totalActivityLogs ?? 0}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <span className="text-gray-600 dark:text-gray-400">Failed Sends:</span>
              <span className="font-semibold text-red-600 dark:text-red-400">{stats?.failedSends ?? 0}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <span className="text-gray-600 dark:text-gray-400">Recent Activity (24h):</span>
              <span className="font-semibold text-gray-900 dark:text-gray-100">{stats?.recentActivity ?? 0}</span>
            </div>
          </div>

          {stats?.lastRotation && (
            <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                <span className="font-medium">Last rotation:</span> {new Date(stats.lastRotation.rotated_at).toLocaleDateString()}
                <br />
                <span className="font-medium">Archived:</span> {stats.lastRotation.records_archived} records
              </p>
            </div>
          )}
        </div>

        {/* Top Channels */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-soft dark:shadow-dark-soft p-6 border border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-6 flex items-center">
            <svg className="w-5 h-5 mr-2 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
            </svg>
            Most Active Channels
          </h3>
          {stats?.topChannels && stats.topChannels.length > 0 ? (
            <div className="space-y-3">
              {stats.topChannels.slice(0, 5).map((channel, index) => (
                <div key={channel.channel_id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                  <div className="flex items-center">
                    <div className="w-8 h-8 bg-gradient-to-br from-gray-400 to-gray-500 rounded-lg flex items-center justify-center text-white text-sm font-bold mr-3">
                      {index + 1}
                    </div>
                    <span className="text-gray-900 dark:text-gray-100 font-medium">
                      {getChannelName(channel.channel_id)}
                    </span>
                  </div>
                  <span className="font-bold text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800 px-2 py-1 rounded-md text-sm">
                    {channel.count}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <svg className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
              <p className="text-gray-500 dark:text-gray-400">No activity data available</p>
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-soft dark:shadow-dark-soft p-6 border border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-6 flex items-center">
          <svg className="w-5 h-5 mr-2 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          Quick Actions
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <a
            href="/logs"
            className="group block p-6 border border-gray-200 dark:border-gray-700 rounded-xl hover:border-blue-300 dark:hover:border-blue-600 transition-all duration-200 hover:shadow-md dark:hover:shadow-lg transform hover:-translate-y-1"
          >
            <div className="flex items-center mb-3">
              <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center group-hover:bg-blue-200 dark:group-hover:bg-blue-900/50 transition-colors">
                <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h4 className="font-semibold text-gray-900 dark:text-gray-100 ml-3">View Logs</h4>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Browse and filter bot activity logs with advanced search
            </p>
          </a>
          
          <a
            href="/logs?status=failed"
            className="group block p-6 border border-gray-200 dark:border-gray-700 rounded-xl hover:border-red-300 dark:hover:border-red-600 transition-all duration-200 hover:shadow-md dark:hover:shadow-lg transform hover:-translate-y-1"
          >
            <div className="flex items-center mb-3">
              <div className="w-8 h-8 bg-red-100 dark:bg-red-900/30 rounded-lg flex items-center justify-center group-hover:bg-red-200 dark:group-hover:bg-red-900/50 transition-colors">
                <svg className="w-4 h-4 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.232 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h4 className="font-semibold text-gray-900 dark:text-gray-100 ml-3">Failed Items</h4>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Review and retry failed operations with one click
            </p>
          </a>
          
          <a
            href="/logs?kind=activity:"
            className="group block p-6 border border-gray-200 dark:border-gray-700 rounded-xl hover:border-green-300 dark:hover:border-green-600 transition-all duration-200 hover:shadow-md dark:hover:shadow-lg transform hover:-translate-y-1"
          >
            <div className="flex items-center mb-3">
              <div className="w-8 h-8 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center group-hover:bg-green-200 dark:group-hover:bg-green-900/50 transition-colors">
                <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <h4 className="font-semibold text-gray-900 dark:text-gray-100 ml-3">Recent Activity</h4>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              See latest bot command activity and user interactions
            </p>
          </a>
        </div>
      </div>
    </div>
  )
}