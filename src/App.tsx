import { en } from './strings/en'

function App() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-2 p-6">
      <h1 className="text-3xl font-bold text-sky-900">{en.app.name}</h1>
      <p className="text-lg text-slate-700">{en.app.tagline}</p>
      <p className="text-slate-600">{en.app.setupNotice}</p>
    </main>
  )
}

export default App
