/* JSX Press — starter templates.
   Used by both the landing page (gallery cards) and the editor (sidebar).
   Each template has: id, name, description, kind (label), and code. */

window.JSX_TEMPLATES = [
  {
    id: 'counter',
    name: 'Counter',
    description: 'The "hello world" of React: state, an event handler, and a button.',
    kind: 'Basics',
    code:
      "function App() {\n" +
      "  const [count, setCount] = React.useState(0);\n" +
      "\n" +
      "  return (\n" +
      "    <div style={{\n" +
      "      fontFamily: 'system-ui, sans-serif',\n" +
      "      padding: '52px 32px',\n" +
      "      textAlign: 'center',\n" +
      "      background: 'linear-gradient(180deg, #f8f7f1, #ece9dc)',\n" +
      "      minHeight: '100vh',\n" +
      "      color: '#2a2620'\n" +
      "    }}>\n" +
      "      <h1 style={{ fontSize: 48, margin: 0, fontFamily: 'Georgia, serif', fontWeight: 400 }}>\n" +
      "        Hello, <em style={{ color: '#7a8a1f' }}>JSX</em>\n" +
      "      </h1>\n" +
      "      <p style={{ color: '#6e6859', marginTop: 12, fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>\n" +
      "        A counter, in fewer than thirty lines.\n" +
      "      </p>\n" +
      "      <button\n" +
      "        onClick={() => setCount(count + 1)}\n" +
      "        style={{\n" +
      "          marginTop: 32,\n" +
      "          padding: '14px 28px',\n" +
      "          background: '#2a2620',\n" +
      "          color: '#c8ff3e',\n" +
      "          border: 'none',\n" +
      "          borderRadius: 4,\n" +
      "          cursor: 'pointer',\n" +
      "          fontSize: 14,\n" +
      "          letterSpacing: '0.06em',\n" +
      "          textTransform: 'uppercase',\n" +
      "          fontWeight: 600\n" +
      "        }}>\n" +
      "        clicked {count} {count === 1 ? 'time' : 'times'}\n" +
      "      </button>\n" +
      "    </div>\n" +
      "  );\n" +
      "}\n",
  },

  {
    id: 'todo',
    name: 'To-do list',
    description: 'Add, toggle, and remove tasks. State arrays, event handlers, conditional styles.',
    kind: 'Patterns',
    code:
      "import { useState } from 'react';\n" +
      "\n" +
      "function App() {\n" +
      "  const [tasks, setTasks] = useState([\n" +
      "    { id: 1, text: 'Read the FAQ', done: true },\n" +
      "    { id: 2, text: 'Write your first component', done: false },\n" +
      "    { id: 3, text: 'Save it to the library', done: false },\n" +
      "  ]);\n" +
      "  const [draft, setDraft] = useState('');\n" +
      "\n" +
      "  const add = () => {\n" +
      "    if (!draft.trim()) return;\n" +
      "    setTasks([...tasks, { id: Date.now(), text: draft, done: false }]);\n" +
      "    setDraft('');\n" +
      "  };\n" +
      "  const toggle = (id) => setTasks(tasks.map(t => t.id === id ? { ...t, done: !t.done } : t));\n" +
      "  const remove = (id) => setTasks(tasks.filter(t => t.id !== id));\n" +
      "\n" +
      "  return (\n" +
      "    <div style={{\n" +
      "      maxWidth: 560, margin: '0 auto', padding: '60px 24px',\n" +
      "      fontFamily: 'system-ui, sans-serif', color: '#1a1a17'\n" +
      "    }}>\n" +
      "      <h1 style={{ fontFamily: 'Georgia, serif', fontWeight: 400, fontSize: 36 }}>To-do</h1>\n" +
      "      <div style={{ display: 'flex', gap: 8, marginTop: 24 }}>\n" +
      "        <input\n" +
      "          value={draft}\n" +
      "          onChange={(e) => setDraft(e.target.value)}\n" +
      "          onKeyDown={(e) => e.key === 'Enter' && add()}\n" +
      "          placeholder='Add a task…'\n" +
      "          style={{\n" +
      "            flex: 1, padding: '10px 14px', fontSize: 14,\n" +
      "            border: '1px solid #d4d1c4', borderRadius: 4, outline: 'none',\n" +
      "            fontFamily: 'inherit'\n" +
      "          }}\n" +
      "        />\n" +
      "        <button onClick={add} style={{\n" +
      "          padding: '10px 18px', background: '#1a1a17', color: '#c8ff3e',\n" +
      "          border: 'none', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit'\n" +
      "        }}>Add</button>\n" +
      "      </div>\n" +
      "      <ul style={{ marginTop: 24, padding: 0, listStyle: 'none' }}>\n" +
      "        {tasks.map(t => (\n" +
      "          <li key={t.id} style={{\n" +
      "            display: 'flex', alignItems: 'center', gap: 12,\n" +
      "            padding: '10px 0', borderBottom: '1px solid #ece9dc'\n" +
      "          }}>\n" +
      "            <input type='checkbox' checked={t.done} onChange={() => toggle(t.id)} />\n" +
      "            <span style={{\n" +
      "              flex: 1,\n" +
      "              textDecoration: t.done ? 'line-through' : 'none',\n" +
      "              color: t.done ? '#aaa' : 'inherit'\n" +
      "            }}>{t.text}</span>\n" +
      "            <button onClick={() => remove(t.id)} style={{\n" +
      "              background: 'transparent', border: 'none', color: '#999',\n" +
      "              cursor: 'pointer', fontSize: 18\n" +
      "            }} title='Remove'>×</button>\n" +
      "          </li>\n" +
      "        ))}\n" +
      "      </ul>\n" +
      "      {tasks.length === 0 && (\n" +
      "        <p style={{ marginTop: 32, color: '#aaa', textAlign: 'center', fontStyle: 'italic' }}>\n" +
      "          Nothing to do.\n" +
      "        </p>\n" +
      "      )}\n" +
      "    </div>\n" +
      "  );\n" +
      "}\n" +
      "\n" +
      "export default App;\n",
  },

  {
    id: 'effect',
    name: 'Live clock',
    description: 'useEffect, an interval, and a render that updates every second.',
    kind: 'Hooks',
    code:
      "import { useState, useEffect } from 'react';\n" +
      "\n" +
      "export default function App() {\n" +
      "  const [now, setNow] = useState(new Date());\n" +
      "\n" +
      "  useEffect(() => {\n" +
      "    const id = setInterval(() => setNow(new Date()), 1000);\n" +
      "    return () => clearInterval(id);\n" +
      "  }, []);\n" +
      "\n" +
      "  const time = now.toLocaleTimeString([], { hour12: false });\n" +
      "  const date = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });\n" +
      "\n" +
      "  return (\n" +
      "    <div style={{\n" +
      "      minHeight: '100vh',\n" +
      "      display: 'grid',\n" +
      "      placeItems: 'center',\n" +
      "      background: '#0e0e0c',\n" +
      "      color: '#f1ede1',\n" +
      "      fontFamily: 'system-ui, sans-serif'\n" +
      "    }}>\n" +
      "      <div style={{ textAlign: 'center' }}>\n" +
      "        <div style={{\n" +
      "          fontSize: 96,\n" +
      "          fontFamily: 'Georgia, serif',\n" +
      "          fontVariantNumeric: 'tabular-nums',\n" +
      "          color: '#c8ff3e',\n" +
      "          letterSpacing: '-0.04em',\n" +
      "          fontWeight: 400\n" +
      "        }}>\n" +
      "          {time}\n" +
      "        </div>\n" +
      "        <div style={{\n" +
      "          marginTop: 8,\n" +
      "          color: '#9b988b',\n" +
      "          fontSize: 14,\n" +
      "          textTransform: 'uppercase',\n" +
      "          letterSpacing: '0.18em'\n" +
      "        }}>\n" +
      "          {date}\n" +
      "        </div>\n" +
      "      </div>\n" +
      "    </div>\n" +
      "  );\n" +
      "}\n",
  },

  {
    id: 'tailwind',
    name: 'Pricing card',
    description: 'A real Tailwind layout. Responsive grid, hover states, the works.',
    kind: 'Tailwind',
    code:
      "function App() {\n" +
      "  const tiers = [\n" +
      "    { name: 'Free', price: '0', features: ['1 project', 'Browser storage', 'Community support'] },\n" +
      "    { name: 'Pro', price: '12', features: ['Unlimited projects', 'Cross-device sync', 'Email support', 'Custom domains'], featured: true },\n" +
      "    { name: 'Team', price: '40', features: ['Everything in Pro', 'Shared workspaces', 'SSO', 'Priority support'] },\n" +
      "  ];\n" +
      "\n" +
      "  return (\n" +
      "    <div className='min-h-screen bg-stone-50 py-16 px-6'>\n" +
      "      <div className='max-w-5xl mx-auto'>\n" +
      "        <h1 className='text-4xl font-serif text-stone-900 text-center mb-3'>\n" +
      "          Simple, fair pricing\n" +
      "        </h1>\n" +
      "        <p className='text-stone-600 text-center mb-12'>No surprise fees, ever.</p>\n" +
      "\n" +
      "        <div className='grid md:grid-cols-3 gap-6'>\n" +
      "          {tiers.map((tier) => (\n" +
      "            <div key={tier.name} className={\n" +
      "              'rounded-lg p-8 transition-shadow ' +\n" +
      "              (tier.featured\n" +
      "                ? 'bg-stone-900 text-stone-50 shadow-2xl scale-105'\n" +
      "                : 'bg-white border border-stone-200 hover:shadow-lg')\n" +
      "            }>\n" +
      "              <div className='text-sm uppercase tracking-widest opacity-70'>{tier.name}</div>\n" +
      "              <div className='mt-3'>\n" +
      "                <span className='text-5xl font-bold'>${tier.price}</span>\n" +
      "                <span className='opacity-60 ml-1'>/mo</span>\n" +
      "              </div>\n" +
      "              <ul className='mt-6 space-y-2 text-sm'>\n" +
      "                {tier.features.map((f) => (\n" +
      "                  <li key={f} className='flex items-center gap-2'>\n" +
      "                    <span className={tier.featured ? 'text-lime-300' : 'text-lime-600'}>✓</span>\n" +
      "                    {f}\n" +
      "                  </li>\n" +
      "                ))}\n" +
      "              </ul>\n" +
      "              <button className={\n" +
      "                'mt-8 w-full py-2.5 rounded font-semibold transition-colors ' +\n" +
      "                (tier.featured\n" +
      "                  ? 'bg-lime-300 text-stone-900 hover:bg-lime-200'\n" +
      "                  : 'bg-stone-900 text-stone-50 hover:bg-stone-700')\n" +
      "              }>\n" +
      "                Choose {tier.name}\n" +
      "              </button>\n" +
      "            </div>\n" +
      "          ))}\n" +
      "        </div>\n" +
      "      </div>\n" +
      "    </div>\n" +
      "  );\n" +
      "}\n",
  },

  {
    id: 'form',
    name: 'Form with validation',
    description: 'Controlled inputs, real-time validation, a submit handler with feedback.',
    kind: 'Patterns',
    code:
      "import { useState } from 'react';\n" +
      "\n" +
      "export default function App() {\n" +
      "  const [form, setForm] = useState({ name: '', email: '', message: '' });\n" +
      "  const [submitted, setSubmitted] = useState(false);\n" +
      "\n" +
      "  const errors = {\n" +
      "    name: form.name.length === 0 ? 'Name is required' : null,\n" +
      "    email: !/^\\S+@\\S+\\.\\S+$/.test(form.email) ? 'Valid email required' : null,\n" +
      "    message: form.message.length < 10 ? 'At least 10 characters' : null,\n" +
      "  };\n" +
      "  const valid = !errors.name && !errors.email && !errors.message;\n" +
      "\n" +
      "  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });\n" +
      "\n" +
      "  const onSubmit = (e) => {\n" +
      "    e.preventDefault();\n" +
      "    if (valid) setSubmitted(true);\n" +
      "  };\n" +
      "\n" +
      "  if (submitted) return (\n" +
      "    <div style={{ padding: 60, textAlign: 'center', fontFamily: 'system-ui' }}>\n" +
      "      <h2 style={{ fontFamily: 'Georgia, serif' }}>Thanks, {form.name}.</h2>\n" +
      "      <p style={{ color: '#777' }}>Your message has been received.</p>\n" +
      "    </div>\n" +
      "  );\n" +
      "\n" +
      "  return (\n" +
      "    <form onSubmit={onSubmit} style={{\n" +
      "      maxWidth: 460, margin: '60px auto', padding: 28,\n" +
      "      fontFamily: 'system-ui, sans-serif', color: '#222'\n" +
      "    }}>\n" +
      "      <h1 style={{ fontFamily: 'Georgia, serif', fontWeight: 400 }}>Get in touch</h1>\n" +
      "\n" +
      "      {['name', 'email', 'message'].map((field) => (\n" +
      "        <div key={field} style={{ marginTop: 18 }}>\n" +
      "          <label style={{ display: 'block', fontSize: 13, marginBottom: 6, textTransform: 'capitalize' }}>\n" +
      "            {field}\n" +
      "          </label>\n" +
      "          {field === 'message' ? (\n" +
      "            <textarea value={form[field]} onChange={update(field)} rows={4} style={inputStyle} />\n" +
      "          ) : (\n" +
      "            <input type={field === 'email' ? 'email' : 'text'} value={form[field]} onChange={update(field)} style={inputStyle} />\n" +
      "          )}\n" +
      "          {errors[field] && form[field] && (\n" +
      "            <div style={{ color: '#c33', fontSize: 12, marginTop: 4 }}>{errors[field]}</div>\n" +
      "          )}\n" +
      "        </div>\n" +
      "      ))}\n" +
      "\n" +
      "      <button type='submit' disabled={!valid} style={{\n" +
      "        marginTop: 24, padding: '12px 24px', width: '100%',\n" +
      "        background: valid ? '#1a1a17' : '#ccc',\n" +
      "        color: valid ? '#c8ff3e' : '#888',\n" +
      "        border: 'none', borderRadius: 4, fontSize: 14, fontWeight: 600,\n" +
      "        cursor: valid ? 'pointer' : 'not-allowed', fontFamily: 'inherit'\n" +
      "      }}>\n" +
      "        Send message\n" +
      "      </button>\n" +
      "    </form>\n" +
      "  );\n" +
      "}\n" +
      "\n" +
      "const inputStyle = {\n" +
      "  width: '100%', padding: '10px 12px', fontSize: 14,\n" +
      "  border: '1px solid #d4d1c4', borderRadius: 4, outline: 'none',\n" +
      "  fontFamily: 'inherit', color: 'inherit'\n" +
      "};\n",
  },

  {
    id: 'animation',
    name: 'CSS animation',
    description: 'A keyframe-animated card, no libraries. Just inline <style> + transforms.',
    kind: 'Visual',
    code:
      "function App() {\n" +
      "  return (\n" +
      "    <div style={{\n" +
      "      minHeight: '100vh',\n" +
      "      display: 'grid',\n" +
      "      placeItems: 'center',\n" +
      "      background: 'radial-gradient(ellipse at top, #f8f7f1, #ece9dc)',\n" +
      "      fontFamily: 'system-ui, sans-serif'\n" +
      "    }}>\n" +
      "      <style>{`\n" +
      "        @keyframes float {\n" +
      "          0%, 100% { transform: translateY(0) rotate(0deg); }\n" +
      "          50% { transform: translateY(-12px) rotate(2deg); }\n" +
      "        }\n" +
      "        @keyframes pulse-ring {\n" +
      "          0% { transform: scale(1); opacity: 1; }\n" +
      "          100% { transform: scale(1.6); opacity: 0; }\n" +
      "        }\n" +
      "        .floating-card {\n" +
      "          animation: float 4s ease-in-out infinite;\n" +
      "          position: relative;\n" +
      "        }\n" +
      "        .ring {\n" +
      "          position: absolute; inset: -2px;\n" +
      "          border: 2px solid #c8ff3e;\n" +
      "          border-radius: 16px;\n" +
      "          animation: pulse-ring 2s ease-out infinite;\n" +
      "        }\n" +
      "      `}</style>\n" +
      "      <div className='floating-card' style={{\n" +
      "        position: 'relative',\n" +
      "        padding: '40px 56px',\n" +
      "        background: '#1a1a17',\n" +
      "        color: '#f1ede1',\n" +
      "        borderRadius: 16,\n" +
      "        boxShadow: '0 24px 48px rgba(0,0,0,0.15)'\n" +
      "      }}>\n" +
      "        <div className='ring' />\n" +
      "        <div style={{ fontSize: 12, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#c8ff3e' }}>Live</div>\n" +
      "        <div style={{ fontFamily: 'Georgia, serif', fontSize: 32, marginTop: 8 }}>It floats.</div>\n" +
      "        <div style={{ color: '#9b988b', marginTop: 4, fontSize: 14 }}>Pure CSS, no libraries.</div>\n" +
      "      </div>\n" +
      "    </div>\n" +
      "  );\n" +
      "}\n",
  },
];
