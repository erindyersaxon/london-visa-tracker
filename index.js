// Data page scripts — loaded deferred

(async () => {
  try {
    // Use pre-fetched promise if available (started in HTML before deferred JS)
    const d = await (window._dataPromise || fetch('/api/data').then(r => r.json()))

    const fmt = (v, unit='d') => v != null ? `${v}<span class="unit">${unit}</span>` : '—'

    // Safari-safe date formatting — avoid toLocaleDateString with locale/timezone args
    const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const MONTHS_LONG  = ['January','February','March','April','May','June','July','August','September','October','November','December']

    const fmtDate = (iso) => {
      if (!iso) return '—'
      try {
        const s = iso.trim()
        // Parse as UTC to avoid timezone shifts
        const parts = s.substring(0, 10).split('-')
        const y = parseInt(parts[0]), m = parseInt(parts[1]) - 1, d = parseInt(parts[2])
        return d + ' ' + MONTHS_SHORT[m] + ' ' + y
      } catch(e) { return '—' }
    }

    const fmtMonth = (ym) => {
      try {
        const parts = ym.split('-')
        const y = parseInt(parts[0]), m = parseInt(parts[1]) - 1
        const name = MONTHS_LONG[m] + ' ' + y
        if (parts[2] === 'early') return 'Early ' + name
        if (parts[2] === 'late')  return 'Late '  + name
        return name
      } catch(e) { return ym }
    }

    const set     = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html }
    const setText = (id, t)    => { const el = document.getElementById(id); if (el) el.textContent = t }

    const m  = d.meta
    const k  = d.key_stats
    const tr = d.trends
    const out= d.outcomes
    const sc = d.stage_counts
    const sa = d.stage_avgs
    const il = d.il_schedule

    // Meta
    set('meta-members', `${m.total_members}+ community members`)
    setText('queue-members', m.total_members)
    const _ud = new Date(m.last_updated)
    const updDate = MONTHS_LONG[_ud.getUTCMonth()] + ' ' + _ud.getUTCFullYear()
    set('meta-updated',   `Updated ${updDate}`)
    set('footer-updated', updDate)

    // Queue block
    set('il-latest-dq',        fmtDate(il.latest_dq_with_il))
    set('il-last-drop',        fmtDate(il.last_il_drop))
    set('il-latest-interview', fmtDate(il.latest_interview))

    // Next window
    if (il.estimated_next_window) {
      const parts = il.estimated_next_window.split('–').map(s => fmtDate(s.trim()))
      set('il-next-window',  parts.join(' – '))
      set('plain-next-window', parts.join(' – '))
    }
    set('il-next-sub', `Based on last drop + 23–33 days (avg gap: ${il.avg_gap_days}d)`)

    // Lookup table
    if (d.il_to_interview_lookup) {
      const now = new Date()
      const curYM = `${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}`
      const tbody = document.getElementById('lookup-body')
      if (tbody) {
        tbody.innerHTML = d.il_to_interview_lookup.map(row => {
          const isCurrent = row.il_month === curYM || row.il_month.startsWith(curYM)
          return `<tr${isCurrent ? ' class="current-row"' : ''}>
            <td class="label-col">${fmtMonth(row.il_month)}</td>
            <td>${fmtMonth(row.interview_month)}</td>
          </tr>`
        }).join('')
      }
    }

    // Key stats
    set('stat-dq-il',      fmt(k.avg_dq_to_il))
    set('stat-il-int',     fmt(k.avg_il_to_interview))
    set('stat-dq-int',     fmt(k.avg_dq_to_interview))
    set('stat-passport',   fmt(k.avg_passport_days))
    set('stat-passport-note', `Median is ${k.median_passport_days ?? '—'} days`)
    set('stat-approval-pct',  fmt(out.approval_pct, '%'))
    set('stat-approval-note', `${out.approved} of ${out.total} recorded outcomes`)

    // Plain English
    set('plain-pickup',    `pick-up averages ${k.avg_pickup_days ?? '—'} days`)
    set('plain-mail',      `mail averages ${k.avg_mail_days ?? '—'} days`)
    set('plain-last-drop', fmtDate(il.last_il_drop))

    // Passport
    set('passport-pickup', `${k.avg_pickup_days ?? '—'} days avg`)
    set('passport-mail',   `${k.avg_mail_days ?? '—'} days avg`)
    setText('passport-median', k.median_passport_days ?? '—')
    setText('passport-n',      sc.passport_in_hand ?? '—')

    // Trend table
    const trendDir = (all, recent) => {
      if (all == null || recent == null) return '<span class="trend-neutral">—</span>'
      const diff = recent - all
      if (Math.abs(diff) <= 3) return '<span class="trend-neutral">→ stable</span>'
      return diff > 0
        ? `<span class="trend-up">↑ +${diff}d</span>`
        : `<span class="trend-down">↓ ${Math.abs(diff)}d</span>`
    }
    const td = v => v != null ? v + 'd' : '—'
    set('trend-dq-il-all',  td(tr.dq_to_il.all_time))
    set('trend-dq-il-12m',  td(tr.dq_to_il.last_12m))
    set('trend-dq-il-6m',   td(tr.dq_to_il.last_6m))
    set('trend-dq-il-3m',   td(tr.dq_to_il.last_3m))
    set('trend-dq-il-dir',  trendDir(tr.dq_to_il.all_time, tr.dq_to_il.last_3m))
    set('trend-il-int-all', td(tr.il_to_interview.all_time))
    set('trend-il-int-12m', td(tr.il_to_interview.last_12m))
    set('trend-il-int-6m',  td(tr.il_to_interview.last_6m))
    set('trend-il-int-3m',  td(tr.il_to_interview.last_3m))
    set('trend-il-int-dir', trendDir(tr.il_to_interview.all_time, tr.il_to_interview.last_3m))
    set('trend-dq-int-all', td(tr.dq_to_interview.all_time))
    set('trend-dq-int-12m', td(tr.dq_to_interview.last_12m))
    set('trend-dq-int-6m',  td(tr.dq_to_interview.last_6m))
    set('trend-dq-int-3m',  td(tr.dq_to_interview.last_3m))
    set('trend-dq-int-dir', trendDir(tr.dq_to_interview.all_time, tr.dq_to_interview.last_3m))

    // Outcomes
    const appPct    = out.approval_pct ?? 0
    const notAppPct = out.total > 0 ? Math.round((out.not_approved / out.total) * 100) : 0
    const ab = document.getElementById('outcome-approved-bar')
    const nb = document.getElementById('outcome-notapp-bar')
    if (ab) ab.style.width = appPct + '%'
    if (nb) nb.style.width = notAppPct + '%'
    set('outcome-approved-pct', appPct + '%')
    set('outcome-approved-n',   `${out.approved} cases`)
    set('outcome-notapp-pct',   notAppPct + '%')
    set('outcome-notapp-n',     `${out.not_approved} cases`)
    setText('outcome-total', out.total)

    // Funnel
    const maxCount = sc.dq || 1
    const funnelData = [
      ['funnel-approval', sc.i130_approval,     sa.pd_to_approval        != null ? `avg ${sa.pd_to_approval}d from PD`      : null],
      ['funnel-dos',      sc.sent_to_dos,        sa.approval_to_dos       != null ? `~${sa.approval_to_dos}d after approval`  : null],
      ['funnel-fees',     sc.nvc_fees_paid,      sa.dos_to_nvc_fees       != null ? `~${sa.dos_to_nvc_fees}d after NVC`       : null],
      ['funnel-docs',     sc.nvc_docs_submitted, sa.fees_to_docs          != null ? `~${sa.fees_to_docs}d after fees`         : null],
      ['funnel-dq',       sc.dq,                 null],
      ['funnel-il',       sc.interview_letter,   k.avg_dq_to_il           != null ? `~${k.avg_dq_to_il}d after DQ`            : null],
      ['funnel-medical',  sc.medical,            sa.il_to_medical         != null ? `~${sa.il_to_medical}d after IL`           : null],
      ['funnel-interview',sc.interview,          null],
      ['funnel-passport', sc.passport_in_hand,   sa.interview_to_passport != null ? `~${sa.interview_to_passport}d after interview` : null],
    ]
    funnelData.forEach(([id, val, dayLabel], i) => {
      setText(id, val ?? '—')
      const bar = document.getElementById(id + '-bar')
      if (bar) bar.style.width = Math.round(((val || 0) / maxCount) * 100) + '%'
      if (dayLabel) {
        const dl = document.getElementById(`funnel-days-${i}`)
        if (dl) dl.textContent = dayLabel
      }
    })

    // IL drop history
    const grid = document.getElementById('drop-grid')
    if (grid && il.recent_drops) {
      grid.innerHTML = il.recent_drops.map(drop => {
        const dqRange = drop.dq_from && drop.dq_to
          ? (drop.dq_from === drop.dq_to
              ? fmtDate(drop.dq_from)
              : fmtDate(drop.dq_from) + ' – ' + fmtDate(drop.dq_to))
          : null
        const dqSpan = dqRange
          ? `<div class="drop-chip-dq">DQ: ${dqRange}${drop.dq_days > 1 ? ' (' + drop.dq_days + 'd)' : ''}</div>`
          : ''
        const countSpan = drop.il_count
          ? `<div class="drop-chip-count">${drop.il_count} IL${drop.il_count !== 1 ? 's' : ''} issued</div>`
          : ''
        return `<div class="drop-chip">
          <div class="drop-chip-date">${fmtDate(drop.date)}</div>
          <div class="drop-chip-gap">${drop.gap != null ? drop.gap + 'd gap' : 'first recorded'}</div>
          ${dqSpan}${countSpan}
        </div>`
      }).join('')
    }
    setText('drop-avg', il.avg_gap_days ?? '—')

    // This week widget
    const week = d.this_week
    if (week) {
      const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
      const fmtDay = (iso) => {
        if (!iso) return ''
        try {
          const s = iso.substring(0, 10).split('-')
          const dt = new Date(Date.UTC(parseInt(s[0]), parseInt(s[1])-1, parseInt(s[2])))
          return DAYS_SHORT[dt.getUTCDay()] + ' ' + parseInt(s[2]) + ' ' + MONTHS_SHORT[parseInt(s[1])-1]
        } catch(e) { return '' }
      }
      const fmtWeekOf = (iso) => {
        if (!iso) return ''
        try {
          const s = iso.substring(0, 10).split('-')
          return 'w/c ' + parseInt(s[2]) + ' ' + MONTHS_SHORT[parseInt(s[1])-1] + ' ' + s[0]
        } catch(e) { return '' }
      }
      const renderMembers = (list, emptyMsg) => {
        if (!list || !list.length) return `<span class="week-empty">${emptyMsg}</span>`
        return list.map(m => `
          <div class="week-member">
            <span class="week-member-name">${m.name}</span>
            <span class="week-member-date">${fmtDay(m.date)}</span>
          </div>`).join('')
      }
      set('week-date', fmtWeekOf(week.week_of))
      document.getElementById('week-interviews').innerHTML = renderMembers(week.interviews, 'None recorded')
      document.getElementById('week-medicals').innerHTML   = renderMembers(week.medicals,   'None recorded')
      document.getElementById('week-flights').innerHTML    = renderMembers(week.flights,     'None recorded')
    }

  } catch (e) {
    console.error('Failed to load live data:', e)
    // Page retains hardcoded fallback values on error
  }
})()

// Back to top button
window.addEventListener('scroll', () => {
  const btn = document.getElementById('back-top');
  if (btn) btn.style.opacity = window.scrollY > 400 ? '1' : '0';
}, { passive: true });
