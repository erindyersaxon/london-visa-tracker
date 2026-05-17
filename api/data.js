export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  const url = `${SUPABASE_URL}/rest/v1/form_responses?embassy=eq.London&select=*&order=submitted_at.desc`

  const response = await fetch(url, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    }
  })

  if (!response.ok) {
    const error = await response.text()
    return res.status(500).json({ error })
  }

  const rows = await response.json()

  // ---------------- helpers ----------------
  const daysBetween = (a, b) => {
    if (!a || !b) return null
    const diff = new Date(b) - new Date(a)
    return Math.round(diff / (1000 * 60 * 60 * 24))
  }

  const avg = (arr) => {
    const valid = arr.filter(n => n !== null && n > 0)
    if (!valid.length) return null
    return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length)
  }

  const median = (arr) => {
    const valid = arr.filter(n => n !== null && n > 0).sort((a, b) => a - b)
    if (!valid.length) return null
    const mid = Math.floor(valid.length / 2)
    return valid.length % 2 ? valid[mid] : Math.round((valid[mid - 1] + valid[mid]) / 2)
  }

  // ---------------- dedupe ----------------
  const byUser = {}
  for (const row of rows) {
    const key = (row.username_raw || '').trim().toLowerCase()
    if (!key) continue
    if (!byUser[key] || new Date(row.submitted_at) > new Date(byUser[key].submitted_at)) {
      byUser[key] = row
    }
  }

  const deduped = Object.values(byUser)
  const standard = deduped.filter(r => !r.interview_expedited)

  // ---------------- wait times ----------------
  const dqToIL = standard
    .filter(r => r.dq_date && r.interview_letter)
    .map(r => daysBetween(r.dq_date, r.interview_letter))

  const ilToInterview = standard
    .filter(r => r.interview_letter && r.interview)
    .map(r => daysBetween(r.interview_letter, r.interview))

  const dqToInterview = standard
    .filter(r => r.dq_date && r.interview)
    .map(r => daysBetween(r.dq_date, r.interview))

  const passportDays = deduped
    .filter(r => r.interview && r.passport_in_hand && r.interview_outcome === 'Approved')
    .map(r => daysBetween(r.interview, r.passport_in_hand))

  const pickupDays = deduped
    .filter(r => r.interview && r.passport_in_hand && r.passport_delivery_method === 'Pickup')
    .map(r => daysBetween(r.interview, r.passport_in_hand))

  const mailDays = deduped
    .filter(r => r.interview && r.passport_in_hand && r.passport_delivery_method === 'Mail')
    .map(r => daysBetween(r.interview, r.passport_in_hand))

  // ---------------- outcomes ----------------
  const withOutcome = deduped.filter(r => r.interview_outcome)
  const approved = withOutcome.filter(r => r.interview_outcome === 'Approved').length
  const notApproved = withOutcome.filter(r =>
    r.interview_outcome === '221g' || r.interview_outcome === 'Administrative Processing'
  ).length

  // ---------------- stage counts ----------------
  const counts = {
    i130_approval: deduped.filter(r => r.i130_approval).length,
    sent_to_dos: deduped.filter(r => r.sent_to_dos).length,
    nvc_fees_paid: deduped.filter(r => r.nvc_fees_paid).length,
    nvc_docs_submitted: deduped.filter(r => r.nvc_docs_submitted).length,
    dq: deduped.filter(r => r.dq_date).length,
    interview_letter: deduped.filter(r => r.interview_letter).length,
    medical: deduped.filter(r => r.medical).length,
    interview: deduped.filter(r => r.interview).length,
    passport_in_hand: deduped.filter(r => r.passport_in_hand).length,
  }

  // ---------------- IL drops ----------------
  const observedDrops = [
    '2026-04-17','2026-03-31','2026-03-04','2026-02-13',
    '2026-01-15','2026-01-01','2025-12-11','2025-11-26',
    '2025-11-11','2025-10-10','2025-09-10','2025-08-11',
    '2025-07-21','2025-06-06',
  ]

  const uniqueILDates = observedDrops

  const ilDrops = uniqueILDates.map((date, i) => {
    const prev = uniqueILDates[i + 1]
    const gap = prev ? daysBetween(prev, date) : null
    return { date, gap }
  })

  // ---------------- IL batch matching ----------------
  const dropCoverage = uniqueILDates.map(dropDate => {

    const dropCases = standard.filter(r => {
      if (!r.dq_date || !r.interview_letter) return false

      const ilDate = new Date(r.interview_letter)
      const observed = new Date(dropDate)

      const diff = Math.abs(Math.round((ilDate - observed) / 86400000))
      return diff <= 2
    })

    if (!dropCases.length) {
      return {
        date: dropDate,
        cases: 0,
        dq_start: null,
        dq_end: null,
        dq_days_covered: null,
        contiguous_ranges: [],
        represented_dq_days: 0,
        largest_block_start: null,
        largest_block_end: null,
        largest_block_days: null,
      }
    }

    const dqDates = [...new Set(dropCases.map(r => r.dq_date))].sort()

    const ranges = []
    let start = dqDates[0]
    let prev = dqDates[0]

    for (let i = 1; i < dqDates.length; i++) {
      const curr = dqDates[i]
      const gap = daysBetween(prev, curr)

      if (gap !== 1) {
        ranges.push({
          start,
          end: prev,
          days: daysBetween(start, prev),
        })
        start = curr
      }

      prev = curr
    }

    ranges.push({
      start,
      end: prev,
      days: daysBetween(start, prev),
    })

    const largest = ranges.reduce((a, b) =>
      (!a || b.days > a.days ? b : a),
    null)

    const represented = ranges.reduce((sum, r) => sum + (r.days + 1), 0)

    return {
      date: dropDate,
      cases: dropCases.length,

      dq_start: dqDates[0],
      dq_end: dqDates[dqDates.length - 1],
      dq_days_covered: daysBetween(dqDates[0], dqDates[dqDates.length - 1]),

      contiguous_ranges: ranges,
      represented_dq_days: represented,

      largest_block_start: largest?.start ?? null,
      largest_block_end: largest?.end ?? null,
      largest_block_days: largest?.days ?? null,
    }
  })

  const ilToInterviewMonths = [
    { il_month: '2026-04', interview_month: '2026-06' },
    { il_month: '2026-03-late', interview_month: '2026-05' },
    { il_month: '2026-03-early', interview_month: '2026-04' },
    { il_month: '2026-02', interview_month: '2026-04' },
    { il_month: '2026-01', interview_month: '2026-03' },
    { il_month: '2025-12', interview_month: '2026-02' },
    { il_month: '2025-11', interview_month: '2026-01' },
    { il_month: '2025-10', interview_month: '2025-12' },
    { il_month: '2025-09', interview_month: '2025-11' },
    { il_month: '2025-08', interview_month: '2025-10' },
    { il_month: '2025-07', interview_month: '2025-09' },
    { il_month: '2025-06', interview_month: '2025-08' },
    { il_month: '2025-05', interview_month: '2025-07' },
    { il_month: '2025-04', interview_month: '2025-06' },
    { il_month: '2025-03', interview_month: '2025-05' },
  ]

  // ---------------- latest stats ----------------
  const latestDQWithIL = standard
    .filter(r => r.dq_date && r.interview_letter)
    .sort((a, b) => new Date(b.dq_date) - new Date(a.dq_date))[0]?.dq_date || null

  const latestInterview = deduped
    .filter(r => r.interview)
    .sort((a, b) => new Date(b.interview) - new Date(a.interview))[0]?.interview || null

  const now = new Date()

  const windowFilter = (months) => {
    const cutoff = new Date(now)
    cutoff.setMonth(cutoff.getMonth() - months)
    return standard.filter(r => r.dq_date && new Date(r.dq_date) >= cutoff)
  }

  const trend = (field) => (months) =>
    avg(windowFilter(months)
      .filter(r => field(r))
      .map(r => field(r)))

  const trendDqToIL = (m) => avg(windowFilter(m)
    .filter(r => r.interview_letter)
    .map(r => daysBetween(r.dq_date, r.interview_letter)))

  const trendILToInterview = (m) => avg(windowFilter(m)
    .filter(r => r.interview_letter && r.interview)
    .map(r => daysBetween(r.interview_letter, r.interview)))

  const trendDqToInterview = (m) => avg(windowFilter(m)
    .filter(r => r.interview)
    .map(r => daysBetween(r.dq_date, r.interview)))

  const normalGaps = ilDrops.filter(d => d.gap && d.gap <= 40)
  const avgGap = Math.round(
    normalGaps.reduce((a, b) => a + b.gap, 0) / normalGaps.length
  )

  const lastILDate = uniqueILDates[0]

  const estimatedNextEarly = lastILDate
    ? new Date(new Date(lastILDate).getTime() + 23 * 86400000)
        .toISOString().split('T')[0]
    : null

  const estimatedNextLate = lastILDate
    ? new Date(new Date(lastILDate).getTime() + 33 * 86400000)
        .toISOString().split('T')[0]
    : null

  // ---------------- weekly tracking ----------------
  const now2 = new Date()
  const dayOfWeek = now2.getUTCDay()
  const weekStart = new Date(now2)
  weekStart.setUTCDate(now2.getUTCDate() - dayOfWeek)
  weekStart.setUTCHours(0,0,0,0)

  const weekEnd = new Date(weekStart)
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6)
  weekEnd.setUTCHours(23,59,59,999)

  const inThisWeek = (dateStr) => {
    if (!dateStr) return false
    const d = new Date(dateStr + 'T12:00:00Z')
    return d >= weekStart && d <= weekEnd
  }

  const weekInterviews = deduped
    .filter(r => inThisWeek(r.interview))
    .map(r => ({ name: r.username_raw, date: r.interview }))

  const weekMedicals = deduped
    .filter(r => inThisWeek(r.medical))
    .map(r => ({ name: r.username_raw, date: r.medical }))

  const weekFlights = deduped
    .filter(r => inThisWeek(r.flight))
    .map(r => ({ name: r.username_raw, date: r.flight }))

  const weekOf = weekStart.toISOString().split('T')[0]

  // ---------------- response ----------------
  return res.status(200).json({
    meta: {
      total_members: deduped.length,
      total_submissions: rows.length,
      last_updated: new Date().toISOString(),
    },

    key_stats: {
      avg_dq_to_il: avg(dqToIL),
      avg_il_to_interview: avg(ilToInterview),
      avg_dq_to_interview: avg(dqToInterview),
      avg_passport_days: avg(passportDays),
      median_passport_days: median(passportDays),
      avg_pickup_days: avg(pickupDays),
      avg_mail_days: avg(mailDays),
    },

    stage_counts: counts,

    il_schedule: {
      latest_dq_with_il: latestDQWithIL,
      last_il_drop: uniqueILDates[0] || null,
      latest_interview: latestInterview,
      avg_gap_days: Math.round(avgGap),
      estimated_next_window: estimatedNextEarly && estimatedNextLate
        ? `${estimatedNextEarly} – ${estimatedNextLate}`
        : null,
      recent_drops: ilDrops.map(drop => {
        const coverage = dropCoverage.find(c => c.date === drop.date)

        return {
          ...drop,
          cases: coverage?.cases ?? 0,
          dq_start: coverage?.dq_start ?? null,
          dq_end: coverage?.dq_end ?? null,
          dq_days_covered: coverage?.dq_days_covered ?? null,
          contiguous_ranges: coverage?.contiguous_ranges ?? [],
          represented_dq_days: coverage?.represented_dq_days ?? 0,
          largest_block_start: coverage?.largest_block_start ?? null,
          largest_block_end: coverage?.largest_block_end ?? null,
          largest_block_days: coverage?.largest_block_days ?? null,
        }
      }),
    },

    il_to_interview_lookup: ilToInterviewMonths,

    this_week: {
      week_of: weekOf,
      interviews: weekInterviews,
      medicals: weekMedicals,
      flights: weekFlights,
    },
  })
      }
