export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok' })
  }

  if (req.method !== 'POST') return res.status(405).end()

  const raw = req.body

  // Convert empty strings to null
  const cleaned = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [
      key,
      value === '' ? null : value
    ])
  )

  // If username_raw is present, upsert on it so returning members update
  // their existing row rather than creating a duplicate.
  // Falls back to plain insert if no username_raw supplied.
  const username = cleaned.username_raw?.trim?.() || null

  let url, method, headers

  const baseHeaders = {
    'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  }

  if (username) {
    // UPSERT — match on username_raw (case-insensitive via ilike not possible in upsert,
    // so we normalise to lowercase before upserting)
    cleaned.username_raw = username.toLowerCase()

    url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/form_responses`
    method = 'POST'
    headers = {
      ...baseHeaders,
      // On conflict with username_raw, update all supplied fields
      // Requires a unique index on username_raw — see note below
      'Prefer': 'resolution=merge-duplicates,return=minimal',
    }
  } else {
    // No username — plain insert
    url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/form_responses`
    method = 'POST'
    headers = {
      ...baseHeaders,
      'Prefer': 'return=minimal',
    }
  }

  const response = await fetch(url, {
    method,
    headers,
    body: JSON.stringify(cleaned)
  })

  if (!response.ok) {
    const error = await response.text()
    return res.status(500).json({ error })
  }

  return res.status(200).json({ success: true })
}
