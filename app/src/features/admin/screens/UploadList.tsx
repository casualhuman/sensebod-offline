/*
 * The list of chosen files with their upload state: used by Upload files
 * (ADM-M-Upload, ADM-Add-2) and by the notes document upload.
 */
import type { ReactNode } from 'react';
import type { UploadKind } from '@shared/api';
import { IconCamera, IconDocument, IconError, IconInfoMark, IconMicrophone, IconSpinner, IconTick, IconTrash, IconVideoFile, IconAnimationPackage } from '@shared/icons';
import { ProgressBar, TypeChip } from '../components';
import { formatBytes, formatProgress, percent } from '../lib/files';
import type { QueueItem } from '../lib/uploadQueue';
import type { RejectedFile } from '../lib/chosenFiles';

export function kindIcon(kind: UploadKind, size = 26): ReactNode {
  if (kind === 'video') return <IconVideoFile size={size} />;
  if (kind === 'audio' || kind === 'voice-note') return <IconMicrophone size={size} />;
  if (kind === 'photo') return <IconCamera size={size} />;
  if (kind === 'animation' || kind === 'h5p') return <IconAnimationPackage size={size} />;
  return <IconDocument size={size} />;
}

/** What the bag does with the file after the bytes arrive, in the board's words. */
export function afterNote(kind: UploadKind, smallerCopy: boolean): string | null {
  if (kind === 'voice-note') return 'Will be converted so every phone can play it.';
  if (kind === 'pdf' || kind === 'word') return 'Pages will be ready to read on any phone.';
  if (kind === 'video' && smallerCopy) return 'Next: making a smaller copy for old phones.';
  return null;
}

export interface UploadRowsProps {
  items: readonly QueueItem[];
  /** True once sending has begun: rows show progress instead of "Becomes". */
  started: boolean;
  smallerCopy: boolean;
  onRemove: (key: string) => void;
}

export function UploadRows({ items, started, smallerCopy, onRemove }: UploadRowsProps) {
  return (
    <ul className="adm-list">
      {items.map((item) => {
        const pct = percent(item.sentBytes, item.totalBytes);
        const note = afterNote(item.info.kind, smallerCopy);
        return (
          <li key={item.key} className={item.state === 'failed' ? 'adm-card adm-card--problem' : 'adm-card'}>
            <div className="adm-row adm-row--top">
              <span className={item.state === 'done' ? 'adm-disc adm-disc--ok' : item.state === 'failed' ? 'adm-disc adm-disc--bad' : 'adm-disc'} aria-hidden="true">
                {item.state === 'done' ? <IconTick size={26} /> : item.state === 'failed' ? <IconError size={26} /> : kindIcon(item.info.kind)}
              </span>
              <div className="adm-row__grow adm-stack--sm">
                <p className="adm-card__title" style={{ wordBreak: 'break-all' }}>
                  {item.name}
                </p>
                <p className="adm-small">
                  {item.info.label} · {formatBytes(item.sizeBytes)}
                </p>
                {!started && item.info.becomes ? (
                  <span className="adm-chips">
                    <span className="adm-chips__lead">Becomes</span>
                    <TypeChip type={item.info.becomes} />
                  </span>
                ) : null}
                {item.state === 'uploading' ? (
                  <>
                    <p className="adm-strong" aria-live="off">
                      {formatProgress(item.sentBytes, item.totalBytes)} · {pct}%
                    </p>
                    <ProgressBar value={pct} label={`${item.name}: ${pct}% sent`} />
                    {note ? <p className="adm-small">{note}</p> : null}
                  </>
                ) : null}
                {item.state === 'saving' ? (
                  <p className="adm-note">
                    <IconSpinner size={20} />
                    <span>On the bag. Saving it as a draft…</span>
                  </p>
                ) : null}
                {started && item.state === 'waiting' ? (
                  <>
                    <p className="adm-strong">Waiting</p>
                    {note ? <p className="adm-small">{note}</p> : null}
                  </>
                ) : null}
                {item.state === 'done' ? (
                  <p className="adm-note adm-note--ok">
                    <IconTick size={20} />
                    <span>
                      Uploaded. Saved on this bag as a draft.
                      {item.upload && item.upload.processing.note ? ` ${item.upload.processing.note}` : ''}
                    </span>
                  </p>
                ) : null}
                {item.state === 'failed' ? (
                  <p className="adm-inline-error" role="alert">
                    Not uploaded. {item.error}
                  </p>
                ) : null}
              </div>
            </div>
            {item.state === 'waiting' || item.state === 'failed' ? (
              <button type="button" className="adm-link-btn adm-link-btn--danger" onClick={() => onRemove(item.key)} aria-label={`Remove ${item.name}`}>
                <IconTrash size={20} />
                Remove
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function RejectedList({ rejected, onDismiss }: { rejected: readonly RejectedFile[]; onDismiss: () => void }) {
  if (rejected.length === 0) return null;
  return (
    <div className="adm-card adm-card--problem adm-stack--sm" role="alert">
      <p className="adm-strong">{rejected.length === 1 ? '1 file was not added' : `${rejected.length} files were not added`}</p>
      <ul className="adm-list">
        {rejected.map((file, index) => (
          <li key={`${file.name}-${index}`} className="adm-small" style={{ marginTop: 4, wordBreak: 'break-word' }}>
            <strong className="adm-strong">{file.name}</strong>: {file.reason}
          </li>
        ))}
      </ul>
      <button type="button" className="adm-link-btn" onClick={onDismiss}>
        OK
      </button>
    </div>
  );
}

export function KeepOpenCard() {
  return (
    <div className="adm-card adm-row adm-row--top">
      <IconInfoMark size={26} />
      <div className="adm-row__grow">
        <p className="adm-strong">Keep this page open</p>
        <p className="adm-small">This may take a few minutes. Stay connected to the bag’s Wi-Fi. Locking your phone can pause it.</p>
      </div>
    </div>
  );
}
