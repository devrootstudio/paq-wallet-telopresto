import { Loader2 } from "lucide-react"

export function Spinner() {
  return (
    <div className="flex flex-col items-center justify-center text-white animate-in fade-in duration-300">
      <Loader2 className="h-16 w-16 animate-spin text-paq-yellow" />
      <p className="mt-4 text-lg font-medium font-montserrat">Procesando...</p>
    </div>
  )
}
