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

  const response = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/form_responses`,
    {
      method: 'POST',
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(cleaned)
    }
  )

  if (!response.ok) {
    const error = await response.text()
    return res.status(500).json({ error })
  }

  return res.status(200).json({ success: true })
}
