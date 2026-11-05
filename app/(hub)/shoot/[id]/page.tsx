import { notFound } from "next/navigation";
import { one } from "@/db";
import { spokenText } from "@/lib/scripts";
import { Teleprompter } from "@/components/Teleprompter";

export default function Prompter({ params }: { params: { id: string } }) {
  const s = one<any>(`SELECT s.*, sp.name AS speaker FROM scripts s JOIN speakers sp ON sp.id = s.speaker_id WHERE s.id = ?`, [Number(params.id)]);
  if (!s) notFound();
  return <Teleprompter title={`${s.speaker} · ${s.title}`} text={spokenText(s)} />;
}
