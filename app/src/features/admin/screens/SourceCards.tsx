/*
 * The four places content comes from (ADM-M-Home "Add content", ADM-Source).
 * One list, used by Home and by the Add screen, so the words never differ.
 */
import type { ReactNode } from 'react';
import type { LessonType } from '@shared/api';
import { IconAnimationPackage, IconCamera, IconChevronRight, IconInfoMark, IconPencil, IconUpload } from '@shared/icons';
import { Link } from '@shared/router';
import { adminPaths } from '../adminPaths';
import { BecomesRow } from '../components';

export interface ContentSource {
  key: 'upload' | 'notes' | 'type' | 'animation';
  to: string;
  title: string;
  /** Phone line (ADM-M-Home). */
  detail: string;
  /** Laptop paragraph (ADM-Source). */
  long: string;
  /** What it accepts, as chips on the laptop card. */
  accepts: string[];
  /** Laptop button words. */
  action: string;
  becomes: LessonType[];
  icon: (size: number) => ReactNode;
}

export const CONTENT_SOURCES: ContentSource[] = [
  {
    key: 'upload',
    to: adminPaths.addUpload(),
    title: 'Upload files',
    detail: 'Videos, voice notes, PDF, Word and photos on your phone',
    long: 'Files already on your phone or laptop: videos, audio and voice notes, documents and photos.',
    accepts: ['Videos', 'Audio', 'Voice notes', 'PDF', 'Word', 'Photos'],
    action: 'Choose files',
    becomes: ['watch', 'listen', 'read'],
    icon: (size) => <IconUpload size={size} />,
  },
  {
    key: 'notes',
    to: adminPaths.addNotes(),
    title: 'Take photos of your notes',
    detail: 'Handwritten notes, one page at a time',
    long: 'Photos of handwritten notes, or a PDF or Word file. Photos become pages in order.',
    accepts: ['Photos of notes', 'PDF', 'Word'],
    action: 'Upload notes',
    becomes: ['read'],
    icon: (size) => <IconCamera size={size} />,
  },
  {
    key: 'type',
    to: adminPaths.addType(),
    title: 'Type it yourself',
    detail: 'Write a short lesson or notes on this phone',
    long: 'Write a short reading lesson, notes or instructions. Kept safe as you type.',
    accepts: ['Headings', 'Lists', 'Pictures', 'Record yourself reading'],
    action: 'Start typing',
    becomes: ['read'],
    icon: (size) => <IconPencil size={size} />,
  },
  {
    key: 'animation',
    to: adminPaths.addAnimation(),
    title: 'Upload an animation',
    detail: 'An animation package from EasySTEM (.zip)',
    long: 'An animation EasySTEM made for you: a .zip package with index.html inside. We check it works offline.',
    accepts: ['.zip package', '.h5p (needs H5P player)'],
    action: 'Choose animation',
    becomes: ['try'],
    icon: (size) => <IconAnimationPackage size={size} />,
  },
];

/** The phone list: big cards, one tap each. */
export function SourceCards() {
  return (
    <>
      <ul className="adm-list">
        {CONTENT_SOURCES.map((source) => (
          <li key={source.key}>
            <Link to={source.to} className="adm-card adm-card--tappable adm-source">
              <span className="adm-row">
                <span className="adm-tile" aria-hidden="true">
                  {source.icon(38)}
                </span>
                <span className="adm-row__grow">
                  <span className="adm-source__title">{source.title}</span>
                  <span className="adm-small" style={{ display: 'block' }}>
                    {source.detail}
                  </span>
                </span>
                <IconChevronRight size={26} />
              </span>
              <span className="adm-source__becomes">
                <BecomesRow types={source.becomes} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="adm-note">
        <IconInfoMark size={20} />
        <span>The type is set for you from what you add. You can change it later.</span>
      </p>
    </>
  );
}
