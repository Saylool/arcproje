"use client";

import { useId, useState } from "react";

import { formatMinorForDisplay } from "@/lib/receipt/money";
import type { Receipt } from "@/lib/receipt/schema";
import {
  MIN_PARTICIPANTS,
  addParticipant,
  checkAssignmentsComplete,
  describeParticipantNameError,
  findParticipantNameIssues,
  getAssignedParticipantIds,
  removeParticipant,
  setParticipantName,
  setPayer,
  toggleItemParticipant,
  type AssignmentState,
  type ParticipantNameError,
} from "@/lib/split/participants";

type ParticipantAssignmentProps = {
  receipt: Receipt;
  state: AssignmentState;
  onChange: (state: AssignmentState) => void;
  onBack: () => void;
  onComplete: () => void;
};

export function ParticipantAssignment({
  receipt,
  state,
  onChange,
  onBack,
  onComplete,
}: ParticipantAssignmentProps) {
  const payerGroupName = useId();
  const newNameInputId = useId();
  const newNameErrorId = useId();

  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState<ParticipantNameError | null>(null);

  const nameIssues = new Map(
    findParticipantNameIssues(state.participants).map((issue) => [
      issue.id,
      issue.error,
    ]),
  );
  const completion = checkAssignmentsComplete(state, receipt.items);

  const handleAdd = () => {
    const result = addParticipant(state, newName);
    if (!result.ok) {
      setAddError(result.error);
      return;
    }
    setAddError(null);
    setNewName("");
    onChange(result.state);
  };

  return (
    <section
      aria-label="Kişiler ve ürün atamaları"
      className="flex flex-col gap-5 rounded-3xl border border-slate-200 bg-white p-4 shadow-card sm:p-5"
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-base font-semibold tracking-tight text-slate-900">
          Kişileri ekle, ürünleri dağıt
        </h2>
        <p className="text-xs leading-relaxed text-slate-500">
          Bir ürünü birden fazla kişiye atarsan o ürün seçtiğin kişiler arasında
          eşit bölünür.
        </p>
      </header>

      {/* --- Kişiler --- */}
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Kişiler
        </h3>

        {state.participants.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500">
            Hiç kişi yok. Aşağıdan kişi ekle.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {state.participants.map((participant, index) => {
              const issue = nameIssues.get(participant.id);
              return (
                <li key={participant.id} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={participant.name}
                      placeholder="İsim"
                      aria-label={`${index + 1}. kişinin adı`}
                      aria-invalid={issue === undefined ? undefined : true}
                      onChange={(event) =>
                        onChange(
                          setParticipantName(
                            state,
                            participant.id,
                            event.target.value,
                          ),
                        )
                      }
                      onBlur={(event) =>
                        onChange(
                          setParticipantName(
                            state,
                            participant.id,
                            event.target.value.trim(),
                          ),
                        )
                      }
                      className={`min-w-0 flex-1 rounded-xl border bg-white px-3 py-2 text-sm text-slate-900 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${
                        issue === undefined
                          ? "border-slate-200 focus:border-violet-300"
                          : "border-red-300 bg-red-50/50"
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        onChange(removeParticipant(state, participant.id))
                      }
                      aria-label={`${participant.name || `${index + 1}. kişi`} kişisini sil`}
                      className="shrink-0 rounded-xl border border-transparent px-2.5 py-2 text-xs font-semibold text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
                    >
                      Sil
                    </button>
                  </div>
                  {issue !== undefined && (
                    <p className="text-[11px] leading-snug text-red-600">
                      {describeParticipantNameError(issue)}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-1 flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <input
              id={newNameInputId}
              type="text"
              value={newName}
              placeholder="Yeni kişi adı"
              aria-label="Yeni kişi adı"
              aria-invalid={addError === null ? undefined : true}
              aria-describedby={addError === null ? undefined : newNameErrorId}
              onChange={(event) => {
                setNewName(event.target.value);
                setAddError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleAdd();
                }
              }}
              className={`min-w-0 flex-1 rounded-xl border bg-white px-3 py-2 text-sm text-slate-900 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${
                addError === null
                  ? "border-slate-200 focus:border-violet-300"
                  : "border-red-300 bg-red-50/50"
              }`}
            />
            <button
              type="button"
              onClick={handleAdd}
              className="shrink-0 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:border-violet-300 hover:text-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
            >
              + Kişi ekle
            </button>
          </div>
          {addError !== null && (
            <p
              id={newNameErrorId}
              role="alert"
              className="text-[11px] leading-snug text-red-600"
            >
              {describeParticipantNameError(addError)}
            </p>
          )}
        </div>
      </div>

      {/* --- Ödeyen --- */}
      {state.participants.length > 0 && (
        <fieldset className="flex flex-col gap-2 border-t border-slate-100 pt-4">
          <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Fişi kim ödedi?
          </legend>
          <div className="flex flex-wrap gap-2">
            {state.participants.map((participant) => (
              <label
                key={participant.id}
                className="cursor-pointer"
                title={participant.name}
              >
                <input
                  type="radio"
                  name={payerGroupName}
                  value={participant.id}
                  checked={state.payerId === participant.id}
                  onChange={() => onChange(setPayer(state, participant.id))}
                  className="peer sr-only"
                />
                <span className="inline-block max-w-[10rem] truncate rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors peer-checked:border-violet-600 peer-checked:bg-violet-600 peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-violet-500">
                  {participant.name || "(isimsiz)"}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {/* --- Ürün atamaları --- */}
      <div className="flex flex-col gap-2 border-t border-slate-100 pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Ürünler
        </h3>

        <ul className="flex flex-col gap-2">
          {receipt.items.map((item) => {
            const assignedIds = getAssignedParticipantIds(state, item.id);
            const isUnassigned = assignedIds.length === 0;

            return (
              <li
                key={item.id}
                className={`rounded-2xl border p-3 ${
                  isUnassigned
                    ? "border-amber-300 bg-amber-50/60"
                    : "border-slate-200"
                }`}
              >
                <fieldset className="flex flex-col gap-2">
                  <legend className="flex w-full items-baseline justify-between gap-3">
                    <span
                      className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900"
                      title={item.name}
                    >
                      {item.name}
                    </span>
                    <span className="shrink-0 text-sm tabular-nums text-slate-500">
                      {formatMinorForDisplay(item.totalMinor, receipt.currency)}
                    </span>
                  </legend>

                  {state.participants.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      Önce kişi ekle.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {state.participants.map((participant) => (
                        <label
                          key={participant.id}
                          className="cursor-pointer"
                          title={participant.name}
                        >
                          <input
                            type="checkbox"
                            checked={assignedIds.includes(participant.id)}
                            onChange={() =>
                              onChange(
                                toggleItemParticipant(
                                  state,
                                  item.id,
                                  participant.id,
                                ),
                              )
                            }
                            className="peer sr-only"
                          />
                          <span className="inline-block max-w-[10rem] truncate rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors peer-checked:border-violet-600 peer-checked:bg-violet-600 peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-violet-500">
                            {participant.name || "(isimsiz)"}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}

                  {isUnassigned && (
                    <p className="text-[11px] leading-snug text-amber-800">
                      Bu ürün henüz kimseye atanmadı.
                    </p>
                  )}
                  {assignedIds.length > 1 && (
                    <p className="text-[11px] leading-snug text-slate-500">
                      {assignedIds.length} kişi arasında eşit bölünecek.
                    </p>
                  )}
                </fieldset>
              </li>
            );
          })}
        </ul>
      </div>

      {/* --- CTA --- */}
      <div className="flex flex-col gap-2 border-t border-slate-100 pt-4">
        <div className="flex flex-col gap-2 sm:flex-row-reverse sm:items-center sm:justify-start">
          <button
            type="button"
            onClick={onComplete}
            disabled={!completion.ok}
            className="inline-flex items-center justify-center rounded-full bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-violet-200 transition-colors hover:bg-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:bg-violet-300 disabled:shadow-none"
          >
            Atamaları kaydet
          </button>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-violet-300 hover:text-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
          >
            Fişe dön
          </button>
        </div>

        <p aria-live="polite" className="text-xs leading-relaxed text-slate-500">
          {completion.ok
            ? `Her ürün atandı. ${MIN_PARTICIPANTS} veya daha fazla kişiyle devam edebilirsin.`
            : completion.message}
        </p>
      </div>
    </section>
  );
}
