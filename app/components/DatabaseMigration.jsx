'use client'

import { useState } from 'react'
import Button from './ui/Button'

export default function DatabaseMigration() {
  const [migrationStatus, setMigrationStatus] = useState(null)
  const [loading, setLoading] = useState(false)

  const runMigration = async () => {
    setLoading(true)
    setMigrationStatus(null)

    try {
      const response = await fetch('/api/admin/migrate-images', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      })

      const result = await response.json()

      if (result.success) {
        setMigrationStatus({
          type: 'success',
          message: result.message
        })
      } else if (result.requiresManualMigration) {
        setMigrationStatus({
          type: 'manual',
          message: result.message,
          instructions: result.instructions
        })
      } else {
        setMigrationStatus({
          type: 'error',
          message: result.error || 'Migration failed'
        })
      }
    } catch (error) {
      setMigrationStatus({
        type: 'error',
        message: 'Network error: ' + error.message
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-surface rounded-xl shadow-lg border border-line-subtle p-4">
      <h3 className="text-sm font-semibold text-fg mb-1">🔧 Database Migration</h3>
      <p className="text-xs text-muted mb-4">
        Run this once to add image support to your database. This adds an image_url column to the items table.
      </p>

      {migrationStatus && (
        <div className={`p-3 rounded-lg mb-4 text-sm ${
          migrationStatus.type === 'success' 
            ? 'bg-success-bg text-success-fg border border-success-border'
            : migrationStatus.type === 'manual'
            ? 'bg-yellow-50 text-yellow-700 border border-yellow-200'
            : 'bg-danger-bg text-danger-fg border border-danger-border'
        }`}>
          <div className="font-medium mb-2">{migrationStatus.message}</div>
          {migrationStatus.instructions && (
            <div className="space-y-2">
              {migrationStatus.instructions.map((instruction, index) => (
                <div key={index} className={index === 0 ? 'font-medium' : 'font-mono text-xs bg-muted p-2 rounded'}>
                  {instruction}
                </div>
              ))}
              <div className="mt-3 p-2 bg-info-bg rounded text-info-fg">
                <strong>How to run manual migration:</strong>
                <ol className="list-decimal list-inside mt-1 space-y-1 text-xs">
                  <li>Go to your Supabase dashboard</li>
                  <li>Navigate to SQL Editor</li>
                  <li>Copy and paste the SQL commands above</li>
                  <li>Click "Run" to execute</li>
                  <li>Refresh this page and try the migration again</li>
                </ol>
              </div>
            </div>
          )}
        </div>
      )}

      <Button onClick={runMigration} loading={loading}>
        {loading ? 'Running Migration…' : 'Run Database Migration'}
      </Button>

      <div className="mt-3 text-xs text-muted">
        <strong>Note:</strong> This is safe to run multiple times. If the column already exists, it will be skipped.
      </div>
    </div>
  )
}
