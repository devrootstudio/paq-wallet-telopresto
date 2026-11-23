/** Bordered message block of the /aval screens. Plain component: usable from server and client. */
export default function Message({
  title,
  children,
  level = 2,
  role,
}: {
  title: string
  children: React.ReactNode
  level?: 1 | 2
  role?: "status" | "alert"
}) {
  const Heading = level === 1 ? "h1" : "h2"
  return (
    <section role={role} className="rounded-2xl border border-white/20 bg-white/5 p-5 text-center">
      <Heading className="mb-2 text-lg font-bold">{title}</Heading>
      <div className="text-sm leading-relaxed text-white/80">{children}</div>
    </section>
  )
}
