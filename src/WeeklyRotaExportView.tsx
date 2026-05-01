export type WeeklyRotaExportTone = 'sancak' | 'cekmekoy' | 'feriha' | 'diger'

export interface WeeklyRotaExportDay {
  key: string
  label: string
  shortDate: string
}

export interface WeeklyRotaExportCell {
  names: string[]
  specialists?: string[]
}

export interface WeeklyRotaExportRow {
  id: string
  unitLabel: string
  cells: WeeklyRotaExportCell[]
}

export interface WeeklyRotaExportGroup {
  id: string
  title: string
  tone: WeeklyRotaExportTone
  rows: WeeklyRotaExportRow[]
}

interface WeeklyRotaExportViewProps {
  title: string
  weekRangeLabel: string
  days: WeeklyRotaExportDay[]
  groups: WeeklyRotaExportGroup[]
  onClose: () => void
  onPrevWeek: () => void
  onNextWeek: () => void
  onPrint: () => void
}

function WeeklyRotaExportView({
  title,
  weekRangeLabel,
  days,
  groups,
  onClose,
  onPrevWeek,
  onNextWeek,
  onPrint,
}: WeeklyRotaExportViewProps) {
  return (
    <div className="weekly-export-page">
      <div className="weekly-export-toolbar no-print">
        <div className="weekly-export-toolbar-group">
          <button type="button" className="ghost-button" onClick={onClose}>
            Planlamaya Dön
          </button>
          <button type="button" className="ghost-button" onClick={onPrevWeek}>
            Önceki Hafta
          </button>
        </div>

        <div className="weekly-export-week-card" aria-label="Seçili hafta">
          <span>Seçili Hafta</span>
          <strong>{weekRangeLabel}</strong>
        </div>

        <div className="weekly-export-toolbar-group weekly-export-toolbar-group-right">
          <button type="button" className="ghost-button" onClick={onNextWeek}>
            Sonraki Hafta
          </button>
          <button type="button" className="secondary" onClick={onPrint}>
            Yazdır / PDF Al
          </button>
        </div>
      </div>

      <section className="weekly-export-sheet">
        <div className="weekly-export-title-block">
          <span>Çalışma Listesi</span>
          <h1>{title}</h1>
          <p>{weekRangeLabel}</p>
        </div>
        <div className="weekly-export-table-wrap">
          <table className="weekly-export-table">
            <thead>
              <tr>
                <th className="group-col" />
                <th className="unit-col">Birim</th>
                {days.map((day) => (
                  <th key={`weekly-export-head-${day.key}`} className="day-col">
                    <strong>{day.label}</strong>
                    <span>{day.shortDate}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) =>
                group.rows.map((row, rowIndex) => (
                  <tr
                    key={`weekly-export-row-${group.id}-${row.id}`}
                    className={`weekly-export-row tone-${group.tone}`}
                  >
                    {rowIndex === 0 ? (
                      <th
                        rowSpan={group.rows.length}
                        className={`group-col group-label tone-${group.tone}`}
                      >
                        <span>{group.title}</span>
                      </th>
                    ) : null}

                    <th className="unit-col">{row.unitLabel}</th>

                    {row.cells.map((cell, cellIndex) => (
                      <td key={`weekly-export-cell-${group.id}-${row.id}-${cellIndex}`}>
                        {cell.specialists?.length || cell.names.length ? (
                          <div className="weekly-export-name-stack">
                            {cell.specialists?.map((specialistLabel) => (
                              <span
                                key={`weekly-export-specialist-${group.id}-${row.id}-${cellIndex}-${specialistLabel}`}
                                className="weekly-export-specialist-line"
                              >
                                {specialistLabel}
                              </span>
                            ))}
                            {cell.names.map((name) => (
                              <span
                                key={`weekly-export-name-${group.id}-${row.id}-${cellIndex}-${name}`}
                                className="weekly-export-assistant-chip"
                              >
                                {name}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="weekly-export-empty" />
                        )}
                      </td>
                    ))}
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

export default WeeklyRotaExportView
