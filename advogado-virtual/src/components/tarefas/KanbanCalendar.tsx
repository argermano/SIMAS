'use client'

import { useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TaskData } from './TaskCard'

interface Column {
  id: string
  name: string
  position: number
  color?: string | null
}

interface KanbanCalendarProps {
  tasks: TaskData[]
  columns: Column[]
}

const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfWeek(year: number, month: number) {
  return new Date(year, month, 1).getDay()
}

function formatDateKey(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Build a map: dateKey → array of column colors for that day */
function buildTaskDateMap(tasks: TaskData[], columns: Column[]) {
  const colColorMap = new Map<string, string>()
  for (const col of columns) {
    if (col.color) colColorMap.set(col.id, col.color)
  }

  const dateMap = new Map<string, Set<string>>()
  for (const task of tasks) {
    if (!task.due_date) continue
    // due_date is ISO string like "2026-03-15" or "2026-03-15T..."
    const dateKey = task.due_date.slice(0, 10)
    const color = task.kanban_column_id ? colColorMap.get(task.kanban_column_id) : undefined
    if (!color) continue

    if (!dateMap.has(dateKey)) dateMap.set(dateKey, new Set())
    dateMap.get(dateKey)!.add(color)
  }

  return dateMap
}

function MiniMonth({
  year,
  month,
  taskDateMap,
}: {
  year: number
  month: number
  taskDateMap: Map<string, Set<string>>
}) {
  const today = new Date()
  const todayKey = formatDateKey(today.getFullYear(), today.getMonth(), today.getDate())

  const daysInMonth = getDaysInMonth(year, month)
  const firstDay = getFirstDayOfWeek(year, month)

  const cells: (number | null)[] = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-foreground font-heading">
        {MONTH_NAMES[month]} {year}
      </p>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 gap-px mb-1">
        {WEEKDAYS.map((d, i) => (
          <div key={i} className="text-center text-[10px] font-medium text-muted-foreground py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Days */}
      <div className="grid grid-cols-7 gap-px">
        {cells.map((day, i) => {
          if (day === null) {
            return <div key={`empty-${i}`} className="h-7" />
          }

          const dateKey = formatDateKey(year, month, day)
          const isToday = dateKey === todayKey
          const colors = taskDateMap.get(dateKey)
          const hasTask = colors && colors.size > 0
          const colorArr = hasTask ? Array.from(colors) : []

          return (
            <div
              key={dateKey}
              className={cn(
                'relative flex flex-col items-center justify-center h-7 rounded-md text-xs transition-colors',
                isToday && !hasTask && 'bg-primary/10 font-bold text-primary',
                isToday && hasTask && 'font-bold',
                !isToday && !hasTask && 'text-muted-foreground',
              )}
              style={
                hasTask && colorArr.length === 1
                  ? { backgroundColor: colorArr[0] + '20', color: colorArr[0] }
                  : undefined
              }
            >
              <span className={cn(hasTask && 'font-semibold')}>{day}</span>
              {/* Dots for multiple column colors */}
              {hasTask && colorArr.length > 1 && (
                <div className="absolute -bottom-0.5 flex gap-0.5">
                  {colorArr.slice(0, 3).map((c, idx) => (
                    <div
                      key={idx}
                      className="h-1 w-1 rounded-full"
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              )}
              {/* Single dot when only one color */}
              {hasTask && colorArr.length === 1 && (
                <div
                  className="absolute -bottom-0.5 h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: colorArr[0] }}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function KanbanCalendar({ tasks, columns }: KanbanCalendarProps) {
  const taskDateMap = useMemo(() => buildTaskDateMap(tasks, columns), [tasks, columns])

  const months = useMemo(() => {
    const now = new Date()
    const result: { year: number; month: number }[] = []
    for (let i = 0; i < 2; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
      result.push({ year: d.getFullYear(), month: d.getMonth() })
    }
    return result
  }, [])

  return (
    <div className="flex w-56 shrink-0 flex-col gap-5 rounded-xl border border-border bg-card p-4">
      {months.map(({ year, month }) => (
        <MiniMonth
          key={`${year}-${month}`}
          year={year}
          month={month}
          taskDateMap={taskDateMap}
        />
      ))}

      {/* Legend */}
      <div className="border-t border-border pt-3">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Legenda
        </p>
        <div className="flex flex-col gap-1.5">
          {columns.map(col => (
            <div key={col.id} className="flex items-center gap-2">
              <div
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: col.color ?? '#94a3b8' }}
              />
              <span className="text-[11px] text-muted-foreground">{col.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
