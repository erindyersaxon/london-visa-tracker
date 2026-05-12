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

  // --- IL drop dates (sorted desc) ---
  const ilDates = deduped
    .filter(r => r.interview_letter)
    .map(r => r.interview_letter)
    .sort((a, b) => new Date(b) - new Date(a))

  // Unique IL drop dates (multiple people can get IL on same day = same batch)
  const uniqueILDates = [...new Set(ilDates)].slice(0, 15)

  // IL drop gaps
  const ilDrops = uniqueILDates.map((date, i) => {
    const prev = uniqueILDates[i + 1]
    const gap = prev ? daysBetween(prev, date) : null
    return { date, gap }
  })

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
  const avgGap = ilDrops.filter(d => d.gap).reduce((a, b) => a + b.gap, 0) /
    ilDrops.filter(d => d.gap).length
  const lastILDate = uniqueILDates[0]
  const estimatedNextEarly = lastILDate
    ? new Date(new Date(lastILDate).getTime() + (avgGap - 7) * 86400000).toISOString().split('T')[0]
    : null
  const estimatedNextLate = lastILDate
    ? new Date(new Date(lastILDate).getTime() + (avgGap + 7) * 86400000).toISOString().split('T')[0]
    : null

  // --- Assemble response ---
  return res.status(200).json({
    meta: {
      total_members: deduped.length,
      total_submissions: rows.length
