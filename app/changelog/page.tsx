import { ChangeDiff } from "@/components/changelog/change-diff";

export default function ChangelogPage() {
  return (
    <div className="px-8 py-10 max-w-[1440px] mx-auto space-y-6">
      <div>
        <h1 className="text-4xl font-extrabold tracking-tight text-slate-900" style={{ fontFamily: "Manrope, sans-serif" }}>
          Policy Changes
        </h1>
        <p className="text-lg text-slate-500 mt-1">
          Track when payer policies are updated. Clinical changes affect coverage criteria; cosmetic changes are formatting or date updates only.
        </p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm px-6 py-5">
        <ChangeDiff />
      </div>
    </div>
  );
}
