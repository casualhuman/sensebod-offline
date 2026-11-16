/* Which code runs which kind of job. The lane is part of the key: the same export kind runs in `data` for a download and in `usb` for a stick. */
import { contentPackInstall } from '../catalog/pack.ts';
import { backupFullUsb, backupRecords, diagnostics, exportLearnerData, usbCheck, usbFormat } from '../exports/jobs.ts';
import { docxText, inspect, packageCheck, pdfPages, smallerCopy, voiceConvert } from '../media/jobs.ts';
import type { Lane } from './queue.ts';
import { JobFailure, type Handler } from './types.ts';

/** A job kind the contract names but this release cannot run yet: it ends `failed`, plainly, and changes nothing. */
function notBuilt(lane: Lane, what: string): Handler {
  return {
    lane,
    run() {
      return Promise.reject(new JobFailure('not_built', `${what} is not part of this release yet.`));
    },
    finalize() {
      return undefined;
    },
    failed(_ctx, tx, _job, state, code) {
      tx.audit({ actorId: 'system', actorName: 'system', action: 'job.failed', outcome: state, detail: { errorCode: code, what } });
      return undefined;
    },
  };
}

const HANDLERS: Record<string, Handler> = {
  'media:inspect': inspect,
  'media:smaller_copy': smallerCopy,
  'media:voice_convert': voiceConvert,
  'media:pdf_pages': pdfPages,
  'media:docx_text': docxText,
  'media:package_check': packageCheck,
  'data:export_learner_data': exportLearnerData('data'),
  'data:backup_records': backupRecords('data'),
  'data:diagnostics': diagnostics('data'),
  'usb:export_learner_data': exportLearnerData('usb'),
  'usb:backup_records': backupRecords('usb'),
  'usb:diagnostics': diagnostics('usb'),
  'usb:backup_full_usb': backupFullUsb,
  'usb:usb_check': usbCheck,
  'usb:usb_format': usbFormat,
  'usb:content_pack_install': contentPackInstall,
  'usb:release_stage': notBuilt('usb', 'Installing an update from a stick'),
};

export function handlerFor(lane: string, kind: string): Handler | null {
  return HANDLERS[`${lane}:${kind}`] ?? null;
}
