export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Fetch all relevant rows - only London embassy, exclude expedited
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

  // --- Helper functions ---
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

  // Deduplicate by username_raw - keep latest submitted_at per user
  const byUser = {}
  for (const row of rows) {
    const key = (row.username_raw || '').trim().toLowerCase()
    if (!key) continue
    if (!byUser[key] || new Date(row.submitted_at) > new Date(byUser[key].submitted_at)) {
      byUser[key] = row
    }
  }
  const deduped = Object.values(byUser)

  // Standard cases only (exclude expedited for wait time calcs)
  const standard = deduped.filter(r => !r.interview_expedited)

  // --- Compute wait times ---
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

  // --- Interview outcomes ---
  const withOutcome = deduped.filter(r => r.interview_outcome)
  const approved = withOutcome.filter(r => r.interview_outcome === 'Approved').length
  const notApproved = withOutcome.filter(r =>
    r.interview_outcome === '221g' || r.interview_outcome === 'Administrative Processing'
  ).length

  // --- Passport by method ---
  const pickupDays = deduped
    .filter(r => r.interview && r.passport_in_hand && r.passport_delivery_method === 'Pickup')
    .map(r => daysBetween(r.interview, r.passport_in_hand))

  const mailDays = deduped
    .filter(r => r.interview && r.passport_in_hand && r.passport_delivery_method === 'Mail')
    .map(r => daysBetween(r.interview, r.passport_in_hand))

  // --- Stage counts ---
  const counts = {
    i130_approval:      deduped.filter(r => r.i130_approval).length,
    sent_to_dos:        deduped.filter(r => r.sent_to_dos).length,
    nvc_fees_paid:      deduped.filter(r => r.nvc_fees_paid).length,
    nvc_docs_submitted: deduped.filter(r => r.nvc_docs_submitted).length,
    dq:                 deduped.filter(r => r.dq_date).length,
    interview_letter:   deduped.filter(r => r.interview_letter).length,
    medical:            deduped.filter(r => r.medical).length,
    interview:          deduped.filter(r => r.interview).length,
    passport_in_hand:   deduped.filter(r => r.passport_in_hand).length,
  }

  // --- Stage averages (days between stages) ---
  const stageAvgs = {
    pd_to_approval: avg(deduped.filter(r => r.i130_priority_date && r.i130_approval)
      .map(r => daysBetween(r.i130_priority_date, r.i130_approval))),
    approval_to_dos: avg(deduped.filter(r => r.i130_approval && r.sent_to_dos)
      .map(r => daysBetween(r.i130_approval, r.sent_to_dos))),
    dos_to_nvc_fees: avg(deduped.filter(r => r.sent_to_dos && r.nvc_fees_paid)
      .map(r => daysBetween(r.sent_to_dos, r.nvc_fees_paid))),
    fees_to_docs: avg(deduped.filter(r => r.nvc_fees_paid && r.nvc_docs_submitted)
      .map(r => daysBetween(r.nvc_fees_paid, r.nvc_docs_submitted))),
    docs_to_dq: avg(deduped.filter(r => r.nvc_docs_submitted && r.dq_date)
      .map(r => daysBetween(r.nvc_docs_submitted, r.dq_date))),
    il_to_medical: avg(standard.filter(r => r.interview_letter && r.medical)
      .map(r => daysBetween(r.interview_letter, r.medical))),
    interview_to_passport: avg(deduped.filter(r => r.interview && r.passport_in_hand)
      .map(r => daysBetween(r.interview, r.passport_in_hand))),
  }

  // --- IL drop dates (hardcoded from observed London channel data) ---
  // These are ground truth — more reliable than inferring from member submissions
  const observedDrops = [
    '2026-04-17',
    '2026-03-31',
    '2026-03-04',
    '2026-02-13',
    '2026-01-15',
    '2026-01-01',
    '2025-12-11',
    '2025-11-26',
    '2025-11-11',
    '2025-10-10',
    '2025-09-10',
    '2025-08-11',
    '2025-07-21',
    '2025-06-06',
  ]

  const uniqueILDates = observedDrops // already sorted desc

  // IL drop gaps
  const ilDrops = uniqueILDates.map((date, i) => {
    const prev = uniqueILDates[i + 1]
    const gap = prev ? daysBetween(prev, date) : null
    return { date, gap }
  })

  // --- IL → Interview month lookup (observed pattern) ---
  const ilToInterviewMonths = [
    { il_month: '2025-04', interview_month: '2025-06' },
    { il_month: '2025-05', interview_month: '2025-07' },
    { il_month: '2025-06', interview_month: '2025-08' },
    { il_month: '2025-07', interview_month: '2025-09' },
    { il_month: '2025-08', interview_month: '2025-10' },
    { il_month: '2025-09', interview_month: '2025-11' },
    { il_month: '2025-10', interview_month: '2025-12' },
    { il_month: '2025-11', interview_month: '2026-01' },
    { il_month: '2025-12', interview_month: '2026-02' },
    { il_month: '2026-01', interview_month: '2026-03' },
    { il_month: '2026-02', interview_month: '2026-04' },
    { il_month: '2026-03-early', interview_month: '2026-04' },
    { il_month: '2026-03-late', interview_month: '2026-05' },
    { il_month: '2026-04', interview_month: '2026-06' },
  ]

  // Latest DQ that has received an IL
  const latestDQWithIL = standard
    .filter(r => r.dq_date && r.interview_letter)
    .sort((a, b) => new Date(b.dq_date) - new Date(a.dq_date))[0]?.dq_date || null

  // Latest scheduled interview
  const latestInterview = deduped
    .filter(r => r.interview)
    .sort((a, b) => new Date(b.interview) - new Date(a.interview))[0]?.interview || null

  // Trend calculation - compare time windows
  const now = new Date()
  const windowFilter = (months) => {
    const cutoff = new Date(now)
    cutoff.setMonth(cutoff.getMonth() - months)
    return standard.filter(r => r.dq_date && new Date(r.dq_date) >= cutoff)
  }

  const trendDqToIL = (months) => avg(
    windowFilter(months)
      .filter(r => r.interview_letter)
      .map(r => daysBetween(r.dq_date, r.interview_letter))
  )
  const trendILToInterview = (months) => avg(
    windowFilter(months)
      .filter(r => r.interview_letter && r.interview)
      .map(r => daysBetween(r.interview_letter, r.interview))
  )
  const trendDqToInterview = (months) => avg(
    windowFilter(months)
      .filter(r => r.interview)
      .map(r => daysBetween(r.dq_date, r.interview))
  )

  // --- Estimated next IL drop ---
  // Use observed average gap from hardcoded drops
  // Exclude outlier gaps (>40 days) from average — matches spreadsheet behaviour
  const normalGaps = ilDrops.filter(d => d.gap && d.gap <= 40)
  const avgGap = Math.round(
    normalGaps.reduce((a, b) => a + b.gap, 0) / normalGaps.length
  )
  const lastILDate = uniqueILDates[0]
  // Fixed offsets matching spreadsheet formula: last_drop + 23 to last_drop + 33
  const estimatedNextEarly = lastILDate
    ? new Date(new Date(lastILDate).getTime() + 23 * 86400000).toISOString().split('T')[0]
    : null
  const estimatedNextLate = lastILDate
    ? new Date(new Date(lastILDate).getTime() + 33 * 86400000).toISOString().split('T')[0]
    : null

  // --- Assemble response ---
  return res.status(200).json({
    meta: {
      total_members: deduped.length,
      total_submissions: rows.length,
      last_updated: new Date().toISOString(),
    },
    key_stats: {
      avg_dq_to_il:         avg(dqToIL),
      avg_il_to_interview:  avg(ilToInterview),
      avg_dq_to_interview:  avg(dqToInterview),
      avg_passport_days:    avg(passportDays),
      median_passport_days: median(passportDays),
      avg_pickup_days:      avg(pickupDays),
      avg_mail_days:        avg(mailDays),
    },
    trends: {
      dq_to_il: {
        all_time: avg(dqToIL),
        last_12m: trendDqToIL(12),
        last_6m:  trendDqToIL(6),
        last_3m:  trendDqToIL(3),
        last_1m:  trendDqToIL(1),
      },
      il_to_interview: {
        all_time: avg(ilToInterview),
        last_12m: trendILToInterview(12),
        last_6m:  trendILToInterview(6),
        last_3m:  trendILToInterview(3),
        last_1m:  trendILToInterview(1),
      },
      dq_to_interview: {
        all_time: avg(dqToInterview),
        last_12m: trendDqToInterview(12),
        last_6m:  trendDqToInterview(6),
        last_3m:  trendDqToInterview(3),
        last_1m:  trendDqToInterview(1),
      },
    },
    outcomes: {
      approved:     approved,
      not_approved: notApproved,
      total:        withOutcome.length,
      approval_pct: withOutcome.length
        ? Math.round((approved / withOutcome.length) * 100)
        : null,
    },
    stage_counts: counts,
    stage_avgs: stageAvgs,
    il_schedule: {
      latest_dq_with_il:      latestDQWithIL,
      last_il_drop:           uniqueILDates[0] || null,
      latest_interview:       latestInterview,
      avg_gap_days:           Math.round(avgGap),
      estimated_next_window:  estimatedNextEarly && estimatedNextLate
        ? `${estimatedNextEarly} – ${estimatedNextLate}`
        : null,
      recent_drops:           ilDrops,
    },
    expedited: {
      count: deduped.filter(r => r.interview_expedited).length,
    },
    il_to_interview_lookup: ilToInterviewMonths,
  })
}
