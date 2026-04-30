interface MonthOption {
  value: string
  label: string
}

interface AssistantMonthlyCalendarCell {
  key: string
  inMonth: boolean
  weekend: boolean
  officialHoliday: boolean
}

interface AssistantMonthlyCalendarLocationItem {
  label: string
  specialistLabel?: string | null
}

interface AssistantMonthlyCalendarDayData {
  locations: AssistantMonthlyCalendarLocationItem[]
  dutySite: string | null
  dayTypeLabel: string | null
  holidayReason: string | null
}

interface AssistantMonthlyTableViewProps {
  assistantName: string
  monthOptions: MonthOption[]
  selectedMonth: string
  displayMonthLabel: string
  weeks: AssistantMonthlyCalendarCell[][]
  dayDataMap: Record<string, AssistantMonthlyCalendarDayData>
  todayISO: string
  onSelectMonth: (monthISO: string) => void
  onApplyMonth: () => void
  onClose: () => void
}

function dutySiteClassName(site: string): string {
  if (site === 'Sancaktepe') {
    return 'sancaktepe'
  }
  if (site === 'Feriha Öz') {
    return 'feriha'
  }
  return 'cekmekoy'
}

function dutySiteShortLabel(site: string): string {
  if (site === 'Sancaktepe') {
    return 'Sancak'
  }
  if (site === 'Feriha Öz') {
    return 'Feriha'
  }
  return 'Çek'
}

function AssistantMonthlyTableView({
  assistantName,
  monthOptions,
  selectedMonth,
  displayMonthLabel,
  weeks,
  dayDataMap,
  todayISO,
  onSelectMonth,
  onApplyMonth,
  onClose,
}: AssistantMonthlyTableViewProps) {
  return (
    <div className="assistant-monthly-table-page">
      <div className="assistant-monthly-table-toolbar no-print">
        <button type="button" className="ghost-button" onClick={onClose}>
          Geri Dön
        </button>
        <select
          className="my-calendar-month-select"
          value={selectedMonth}
          onChange={(event) => onSelectMonth(event.target.value)}
        >
          {monthOptions.map((option) => (
            <option key={`assistant-table-month-${option.value}`} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button type="button" className="secondary" onClick={onApplyMonth}>
          Görüntüle
        </button>
      </div>

      <section className="assistant-monthly-table-sheet">
        <h1>{assistantName || 'Asistan'} - Aylık Takvim</h1>
        <p>{displayMonthLabel}</p>

        <div className="my-calendar-scroll assistant-monthly-calendar-scroll">
          <div className="assistant-monthly-calendar-inner">
            <div className="my-calendar-weekdays">
              {['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'].map((weekday) => (
                <span key={`assistant-calendar-weekday-${weekday}`}>{weekday}</span>
              ))}
            </div>

            <div className="my-calendar-grid">
              {weeks.flat().map((cell) => {
                const dayDate = new Date(cell.key)
                const dayNumber = dayDate.getDate()
                const dayData = dayDataMap[cell.key]
                const locations = dayData?.locations ?? []
                const dutySite = dayData?.dutySite ?? null
                const dayTypeLabel = dayData?.dayTypeLabel ?? null
                const holidayReason = cell.inMonth ? dayData?.holidayReason ?? null : null

                return (
                  <article
                    key={`assistant-table-calendar-${cell.key}`}
                    className={`my-calendar-cell${cell.inMonth ? '' : ' outside-month'}${
                      cell.weekend ? ' weekend' : ''
                    }${cell.officialHoliday ? ' holiday' : ''}${cell.key === todayISO ? ' today' : ''}`}
                  >
                    <header>
                      <strong>{dayNumber}</strong>
                      <small>{cell.key}</small>
                    </header>

                    <div className="my-calendar-content">
                      {holidayReason ? <span className="my-calendar-holiday-reason">{holidayReason}</span> : null}

                      {dutySite ? (
                        <span className={`my-calendar-duty duty-site-${dutySiteClassName(dutySite)}`}>
                          Nöbet ({dutySiteShortLabel(dutySite)})
                        </span>
                      ) : null}

                      {locations.map((locationItem) => (
                        <span
                          key={`assistant-table-location-${cell.key}-${locationItem.label}`}
                          className="my-calendar-location"
                        >
                          {locationItem.specialistLabel ? (
                            <strong className="my-calendar-specialist-label">
                              {locationItem.specialistLabel}
                            </strong>
                          ) : null}
                          <span>{locationItem.label}</span>
                        </span>
                      ))}

                      {!dutySite && !locations.length ? (
                        <span className="empty tiny">
                          {cell.inMonth && dayTypeLabel
                            ? holidayReason
                              ? 'Resmi tatil'
                              : dayTypeLabel
                            : cell.inMonth
                              ? 'Atama yok'
                              : ''}
                        </span>
                      ) : null}
                    </div>
                  </article>
                )
              })}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

export type { AssistantMonthlyCalendarCell, AssistantMonthlyCalendarDayData, MonthOption }
export default AssistantMonthlyTableView
