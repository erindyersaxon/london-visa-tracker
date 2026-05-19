export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok' })
  }

  if (req.method !== 'POST') return res.status(405).end()

  const raw = req.body

  // Convert empty strings and arrays to null
  const cleaned = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [
      key,
      value === '' || (Array.isArray(value) && value.length === 0) ? null : value
    ])
  )

  const username = cleaned.username_raw?.trim?.() || null

  const baseHeaders = {
    'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

  if (username) {
    // Normalise username to lowercase
    cleaned.username_raw = username.toLowerCase()

    // Step 1: check if row already exists
    const checkRes = await fetch(
      `${supabaseUrl}/rest/v1/form_responses?username_raw=eq.${encodeURIComponent(cleaned.username_raw)}&select=id`,
      { headers: baseHeaders }
    )
    const existing = await checkRes.json()

    if (existing && existing.length > 0) {
      // Row exists — PATCH (update) only non-null fields
      const existingId = existing[0].id

      // Only send fields that have actual values — don't overwrite existing data with nulls
      const updatePayload = Object.fromEntries(
        Object.entries(cleaned).filter(([_, v]) => v !== null && v !== undefined)
      )
      // Always update submitted_at
      updatePayload.submitted_at = new Date().toISOString()

      const updateRes = await fetch(
        `${supabaseUrl}/rest/v1/form_responses?id=eq.${existingId}`,
        {
          method: 'PATCH',
          headers: { ...baseHeaders, 'Prefer': 'return=minimal' },
          body: JSON.stringify(updatePayload)
        }
      )

      if (!updateRes.ok) {
        const error = await updateRes.text()
        return res.status(500).json({ error })
      }

      return res.status(200).json({ success: true, action: 'updated' })

    } else {
      // No existing row — INSERT
      const insertRes = await fetch(
        `${supabaseUrl}/rest/v1/form_responses`,
        {
          method: 'POST',
          headers: { ...baseHeaders, 'Prefer': 'return=minimal' },
          body: JSON.stringify(cleaned)
        }
      )

      if (!insertRes.ok) {
        const error = await insertRes.text()
        return res.status(500).json({ error })
      }

      return res.status(200).json({ success: true, action: 'inserted' })
    }

  } else {
    // No username — plain insert
    const insertRes = await fetch(
      `${supabaseUrl}/rest/v1/form_responses`,
      {
        method: 'POST',
        headers: { ...baseHeaders, 'Prefer': 'return=minimal' },
        body: JSON.stringify(cleaned)
      }
    )

    if (!insertRes.ok) {
      const error = await insertRes.text()
      return res.status(500).json({ error })
    }

    return res.status(200).json({ success: true, action: 'inserted' })
  }
}
