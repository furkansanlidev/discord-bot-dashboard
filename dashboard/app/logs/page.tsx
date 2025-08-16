'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'

interface LogEntry {
  id: number
  kind: string
  source: string | null
  channel_id: string | null
  user_id: string | null
  content: string | null
  status: string
  error: string | null
  message_id: string | null
  ref_id: number | null
  timestamp: string
  log_type: 'send' | 'activity'
}

interface Channel {
  id: string
  name: string
  position: number
}

export default function LogsPage() {
  const { data: session } = useSession()
  const searchParams = useSearchParams()
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  
  // Filters - initialize from URL params
  const [kindFilter, setKindFilter] = useState(searchParams?.get('kind') || '')
  const [statusFilter, setStatusFilter] = useState(searchParams?.get('status') || '')
  const [channelFilter, setChannelFilter] = useState(searchParams?.get('channel_id') || '')
  const [searchQuery, setSearchQuery] = useState(searchParams?.get('q') || '')
  
  // Auto-refresh
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [refreshInterval, setRefreshInterval] = useState<NodeJS.Timeout | null>(null)
  
  // UI state
  const [retryingIds, setRetryingIds] = useState<Set<number>>(new Set())
  const [clearing, setClearing] = useState(false)

  const fetchLogs = useCallback(async (reset = false) => {
    try {
      const params = new URLSearchParams()
      if (kindFilter) params.set('kind', kindFilter)
      if (statusFilter) params.set('status', statusFilter)
      if (channelFilter) params.set('channel_id', channelFilter)
      if (searchQuery) params.set('q', searchQuery)
      if (!reset && nextCursor) params.set('cursor', nextCursor)
      params.set('limit', '50')

      const response = await fetch(`/api/logs?${params}`)
      if (!response.ok) throw new Error('Failed to fetch logs')
      
      const data = await response.json()
      
      if (reset) {
        setLogs(data.logs)
      } else {
        setLogs(prev => [...prev, ...data.logs])
      }
      
      setHasMore(data.hasMore)
      setNextCursor(data.nextCursor)
    } catch (error) {
      console.error('Error fetching logs:', error)
    } finally {
      setLoading(false)
    }
  }, [kindFilter, statusFilter, channelFilter, searchQuery, nextCursor])

  const fetchChannels = useCallback(async () => {
    try {
      const response = await fetch('/api/discord/channels')
      if (response.ok) {
        const data = await response.json()
        setChannels(data.channels || [])
      }
    } catch (error) {
      console.error('Error fetching channels:', error)
    }
  }, [])

  const handleFilterChange = useCallback(() => {
    setLogs([])
    setNextCursor(null)
    setLoading(true)
    fetchLogs(true)
  }, [fetchLogs])

  const handleRetry = async (logId: number) => {
    setRetryingIds(prev => new Set(prev.add(logId)))
    
    try {
      const response = await fetch(`/api/logs/${logId}/retry`, {
        method: 'POST',
        headers: {
          'x-logs-token': process.env.NEXT_PUBLIC_LOGS_TOKEN!,
        },
      })
      
      if (response.ok) {
        handleFilterChange()
      } else {
        const error = await response.json()
        alert(`Retry failed: ${error.error}`)
      }
    } catch (error) {
      console.error('Error retrying log:', error)
      alert('Failed to retry log entry')
    } finally {
      setRetryingIds(prev => {
        const newSet = new Set(prev)
        newSet.delete(logId)
        return newSet
      })
    }
  }

  const handleClearLogs = async () => {
    if (!confirm('Are you sure you want to clear all logs? This cannot be undone.')) {
      return
    }
    
    setClearing(true)
    
    try {
      const response = await fetch('/api/logs/clear', {
        method: 'DELETE',
        headers: {
          'x-logs-token': process.env.NEXT_PUBLIC_LOGS_TOKEN!,
        },
      })
      
      if (response.ok) {
        setLogs([])
        setNextCursor(null)
        setHasMore(false)
      } else {
        const error = await response.json()
        alert(`Clear failed: ${error.error}`)
      }
    } catch (error) {
      console.error('Error clearing logs:', error)
      alert('Failed to clear logs')
    } finally {
      setClearing(false)
    }
  }

  const toggleAutoRefresh = () => {
    if (autoRefresh) {
      if (refreshInterval) {
        clearInterval(refreshInterval)
        setRefreshInterval(null)
      }
    } else {
      const interval = setInterval(() => {
        handleFilterChange()
      }, 5000)
      setRefreshInterval(interval)
    }
    setAutoRefresh(!autoRefresh)
  }

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString()
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success': return 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
      case 'failed': return 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
      default: return 'text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700'
    }
  }

  const getKindColor = (kind: string) => {
    if (kind.startsWith('activity:')) return 'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
    if (kind === 'reminder') return 'text-purple-700 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800'
    if (kind === 'task') return 'text-orange-700 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800'
    return 'text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700'
  }

  const getChannelName = (channelId: string) => {
    const channel = channels.find(c => c.id === channelId)
    return channel ? `#${channel.name}` : `#${channelId.slice(-4)}`
  }

  const getLogIcon = (kind: string, status: string) => {
    if (status === 'failed') {
      return (
        <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.232 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
      )
    }
    
    if (kind === 'reminder') {
      return (
        <svg className="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    }
    
    if (kind === 'task') {
      return (
        <svg className="w-4 h-4 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      )
    }
    
    if (kind.startsWith('activity:')) {
      return (
        <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      )
    }
    
    return (
      <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    )
  }

  useEffect(() => {
    fetchChannels()
    fetchLogs(true)
  }, [])

  useEffect(() => {
    handleFilterChange()
  }, [kindFilter, statusFilter, channelFilter, searchQuery])

  useEffect(() => {
    return () => {
      if (refreshInterval) {
        clearInterval(refreshInterval)
      }
    }
  }, [refreshInterval])

  if (!session) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 bg-gradient-to-br from-gray-400 to-gray-500 rounded-xl flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <p className="text-gray-600 dark:text-gray-400">Please sign in to view logs.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center">
            <svg className="w-8 h-8 mr-3 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Bot Logs
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Monitor and manage your bot's activity
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={toggleAutoRefresh}
            className={`inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-gray-800 ${
              autoRefresh
                ? 'bg-green-500 hover:bg-green-600 text-white focus:ring-green-500'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 focus:ring-gray-500'
            }`}
          >
            <svg className={`w-4 h-4 mr-2 ${autoRefresh ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
          </button>
          <button
            onClick={handleClearLogs}
            disabled={clearing}
            className="inline-flex items-center px-4 py-2 bg-red-500 hover:bg-red-600 disabled:bg-red-400 text-white rounded-lg text-sm font-medium transition-all duration-200 transform hover:scale-105 disabled:scale-100 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            {clearing ? 'Clearing...' : 'Clear All'}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-soft dark:shadow-dark-soft border border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-4 flex items-center">
          <svg className="w-4 h-4 mr-2 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          Filters
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Kind
            </label>
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            >
              <option value="">All kinds</option>
              <option value="reminder">Reminders</option>
              <option value="task">Tasks</option>
              <option value="activity:">Activities</option>
              <option value="send_once">Send Once</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            >
              <option value="">All statuses</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Channel
            </label>
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            >
              <option value="">All channels</option>
              {channels.map(channel => (
                <option key={channel.id} value={channel.id}>
                  #{channel.name}
                </option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Search
            </label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search content, kind, error..."
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            />
          </div>
        </div>
      </div>

      {/* Logs */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-soft dark:shadow-dark-soft border border-gray-200 dark:border-gray-700">
        {loading && logs.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            <span className="ml-3 text-gray-600 dark:text-gray-400">Loading logs...</span>
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-12">
            <svg className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-gray-500 dark:text-gray-400 text-lg">No logs found</p>
            <p className="text-gray-400 dark:text-gray-500 text-sm mt-1">Try adjusting your filters or check back later</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {logs.map((log) => {
              const canRetry = log.status === 'failed' && (log.kind === 'reminder' || log.kind === 'task')
              
              return (
                <div key={`${log.log_type}-${log.id}`} className="p-6 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all duration-200">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-3 mb-3">
                        <div className="flex-shrink-0">
                          {getLogIcon(log.kind, log.status)}
                        </div>
                        <span className={`inline-flex px-3 py-1 text-xs font-medium rounded-full border ${getKindColor(log.kind)}`}>
                          {log.kind}
                        </span>
                        <span className={`inline-flex px-3 py-1 text-xs font-medium rounded-full border ${getStatusColor(log.status)}`}>
                          {log.status}
                        </span>
                        {log.source && (
                          <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded-md">
                            via {log.source}
                          </span>
                        )}
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {formatTimestamp(log.timestamp)}
                        </span>
                      </div>
                      
                      {log.content && (
                        <p className="text-sm text-gray-900 dark:text-gray-100 mb-3 bg-gray-50 dark:bg-gray-700/50 p-3 rounded-lg">
                          {log.content}
                        </p>
                      )}
                      
                      {log.error && (
                        <div className="mb-3">
                          <p className="text-sm text-red-600 dark:text-red-400 font-mono bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-200 dark:border-red-800">
                            <span className="font-bold">Error:</span> {log.error}
                          </p>
                        </div>
                      )}
                      
                      <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                        {log.channel_id && (
                          <span className="flex items-center">
                            <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                            </svg>
                            {getChannelName(log.channel_id)}
                          </span>
                        )}
                        {log.message_id && (
                          <span className="flex items-center">
                            <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                            </svg>
                            {log.message_id.slice(-8)}
                          </span>
                        )}
                        {log.ref_id && (
                          <span className="flex items-center">
                            <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                            </svg>
                            Ref: {log.ref_id}
                          </span>
                        )}
                      </div>
                    </div>
                    
                    {canRetry && (
                      <button
                        onClick={() => handleRetry(log.id)}
                        disabled={retryingIds.has(log.id)}
                        className="ml-4 inline-flex items-center px-3 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-400 text-white text-xs rounded-lg font-medium transition-all duration-200 transform hover:scale-105 disabled:scale-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
                      >
                        {retryingIds.has(log.id) ? (
                          <>
                            <svg className="w-3 h-3 mr-1 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            Retrying...
                          </>
                        ) : (
                          <>
                            <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            Retry
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
        
        {hasMore && (
          <div className="p-6 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={() => fetchLogs(false)}
              className="w-full py-3 px-4 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-all duration-200 font-medium"
            >
              Load More Logs
            </button>
          </div>
        )}
      </div>
    </div>
  )
}