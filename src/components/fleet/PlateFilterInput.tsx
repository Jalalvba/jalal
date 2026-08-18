import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export function PlateFilterInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative mt-2">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Rechercher par immatriculation…"
        className="bg-muted/60 pl-10"
      />
    </div>
  );
}
