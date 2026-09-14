import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../../i18n";
import {
  statuses,
  type SearchField,
  type SearchStatus,
  type TimeBasis,
} from "./model";
import styles from "./SessionSearch.module.css";

export function CheckIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m4 12 5 5L20 5" />
    </svg>
  );
}
export function SearchHeader({
  query,
  onQuery,
  fields,
  onFields,
  supported,
}: {
  query: string;
  onQuery(value: string): void;
  fields: SearchField[];
  onFields(value: SearchField[]): void;
  supported: boolean;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const desktop = matchMedia("(min-width: 701px)");
    const focus = () => {
      if (
        desktop.matches &&
        !document.querySelector('[role="dialog"],dialog[open]')
      )
        input.current?.focus({ preventScroll: true });
    };
    const editable =
      'input:not([type="checkbox"]):not([type="radio"]),textarea,select,[contenteditable="true"],[role="menu"],[role="dialog"]';
    const click = (e: Event) => {
      if (!(e.target instanceof Element) || !e.target.closest(editable))
        focus();
    };
    const focusIn = () => {
      if (
        !(document.activeElement instanceof Element) ||
        !document.activeElement.closest(editable)
      )
        focus();
    };
    const change = (e: Event) => {
      if (e.target instanceof HTMLSelectElement) focus();
    };
    focus();
    document.addEventListener("click", click);
    document.addEventListener("focusin", focusIn);
    document.addEventListener("change", change);
    window.addEventListener("focus", focusIn);
    return () => {
      document.removeEventListener("click", click);
      document.removeEventListener("focusin", focusIn);
      document.removeEventListener("change", change);
      window.removeEventListener("focus", focusIn);
    };
  }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        !event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        !["s", "r"].includes(event.key.toLowerCase())
      )
        return;
      event.preventDefault();
      if (supported)
        onFields([event.key.toLowerCase() === "s" ? "assistant" : "user"]);
      input.current?.focus();
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [onFields, supported]);
  return (
    <div className={styles.header}>
      <div className={styles.fields}>
        <span className={styles.searchIn}>{t("sessionSearchIn")}</span>
        {(["title", "assistant", "user"] as const).map((field) => (
          <label
            key={field}
            title={
              field !== "title" && !supported
                ? t("sessionSearchUpgrade")
                : field === "title"
                  ? t("sessionSearchTitleHelp")
                  : undefined
            }
          >
            <input
              type="checkbox"
              checked={fields.includes(field)}
              disabled={field !== "title" && !supported}
              onChange={(e) =>
                onFields(
                  e.target.checked
                    ? [...fields, field]
                    : fields.filter((f) => f !== field),
                )
              }
            />
            {t(`sessionSearchField_${field}`)}
            {field !== "title" && (
              <kbd>{field === "assistant" ? "C-s" : "C-r"}</kbd>
            )}
          </label>
        ))}
      </div>
      <input
        ref={input}
        className={styles.search}
        type="search"
        value={query}
        maxLength={512}
        onChange={(e) => onQuery(e.target.value)}
        placeholder={t("globalSessionsSearchPlaceholder")}
        aria-label={t("globalSessionsSearchPlaceholder")}
      />
    </div>
  );
}

function RangeField({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string;
  onChange(value: string): void;
  label: string;
  placeholder: string;
}) {
  const [reservation, setReservation] = useState(3);
  return (
    <span className={styles.ageField}>
      <span aria-hidden="true">
        {(value || placeholder).padEnd(reservation, "0")}
      </span>
      <input
        aria-label={label}
        placeholder={placeholder}
        value={value}
        maxLength={20}
        onChange={(e) => {
          const value = e.target.value;
          if (value.length >= reservation)
            setReservation(Math.ceil((value.length + 1) / 2) * 2);
          onChange(value);
        }}
      />
    </span>
  );
}

export function SearchFilters({
  basis,
  onBasis,
  young,
  old,
  onYoung,
  onOld,
  limit,
  onLimit,
  children,
}: {
  basis: TimeBasis;
  onBasis(value: TimeBasis): void;
  young: string;
  old: string;
  onYoung(value: string): void;
  onOld(value: string): void;
  limit: string;
  onLimit(value: string): void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className={styles.filterRow}>
      <div className={styles.range}>
        <div className={styles.basis}>
          {(["turns", "activity", "created"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={basis === value}
              onClick={() => onBasis(value)}
            >
              {t(`sessionSearchTime_${value}`)}
            </button>
          ))}
        </div>
        <div className={styles.age}>
          <RangeField
            label={t("sessionSearchFrom")}
            placeholder="0d"
            value={young}
            onChange={onYoung}
          />
          <span>–</span>
          <RangeField
            label={t("sessionSearchTo")}
            placeholder="∞d"
            value={old}
            onChange={onOld}
          />
        </div>
      </div>
      <div className={styles.filters}>
        {children}
        <label className={styles.limit} title={t("sessionSearchLimitHelp")}>
          {t("sessionSearchLimit")}
          <input
            inputMode="numeric"
            placeholder="∞"
            value={limit}
            onChange={(e) => onLimit(e.target.value)}
            aria-label={t("sessionSearchLimit")}
          />
        </label>
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: SearchStatus }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill={status === "starred" ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {status === "archived" || status === "unarchived" ? (
        <>
          <rect x="3" y="4" width="18" height="4" rx="1" />
          <path d="M5 8v12h14V8M10 12h4" />
          {status === "unarchived" && <path d="m3 21 18-18" />}
        </>
      ) : status === "starred" || status === "unstarred" ? (
        <path d="m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z" />
      ) : (
        <>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m3 7 9 6 9-6" />
          {status === "read" && <path d="m8 16 3 3 6-6" />}
        </>
      )}
    </svg>
  );
}

export function SearchSelection({
  count,
  shown,
  filters,
  onToggle,
  onReplace,
  onClear,
  onManage,
  onApply,
  pending,
}: {
  count: number;
  shown: number;
  filters: SearchStatus[];
  onToggle(status: SearchStatus): void;
  onReplace(): void;
  onClear(): void;
  onManage(): void;
  onApply(): void;
  pending: boolean;
}) {
  const { t } = useI18n();
  const action = filters.at(-1);
  return (
    <div className={styles.scope}>
      <div className={styles.selectionInfo}>
        <button
          type="button"
          className={styles.selectionCount}
          title={t("sessionSearchSelectionHelp", {
            count,
            shown,
            hidden: Math.max(0, count - shown),
          })}
          onClick={onManage}
        >
          <CheckIcon />
          {count}
        </button>
        <button
          type="button"
          className={styles.selectMatched}
          onClick={onReplace}
          disabled={!shown || pending}
          title={t("sessionSearchKeep", { count: shown })}
          aria-label={t("sessionSearchKeep", { count: shown })}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            aria-hidden="true"
          >
            <path d="M20 12H4m7-7-7 7 7 7" />
          </svg>
        </button>
        <span>{shown}</span>
        {count > 0 && (
          <button
            type="button"
            className={styles.clearSelection}
            onClick={onClear}
            disabled={pending}
            title={t("sessionSearchClear", { count })}
            aria-label={t("sessionSearchClear", { count })}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.8"
              aria-hidden="true"
            >
              <path d="m5 5 14 14M19 5 5 19" />
            </svg>
          </button>
        )}
      </div>
      <div className={styles.statusFilters}>
        <span>{t("sessionSearchFilter")}</span>
        {statuses.map((status) => (
          <button
            key={status}
            type="button"
            aria-pressed={filters.includes(status)}
            title={t("sessionSearchStatusFilter", {
              status: t(`sessionSearchStatus_${status}`),
            })}
            aria-label={t("sessionSearchStatusFilter", {
              status: t(`sessionSearchStatus_${status}`),
            })}
            onClick={() => onToggle(status)}
          >
            <StatusIcon status={status} />
          </button>
        ))}
      </div>
      {action && (
        <button
          type="button"
          className={styles.applyStatus}
          onClick={onApply}
          disabled={!count || pending}
          title={t("sessionSearchApplyHelp", {
            status: t(`sessionSearchStatus_${action}`),
            count,
          })}
        >
          <span>
            {t("sessionSearchMake", {
              status: t(`sessionSearchStatus_${action}`),
            })}
          </span>
          <CheckIcon />
          {count}
        </button>
      )}
    </div>
  );
}
