export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-micro font-bold uppercase text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
