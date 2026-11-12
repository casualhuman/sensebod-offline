/*
 * Kitchen sink: every shared component in every state, for checking against
 * the V3-Components board. Open http://localhost:5173/__dev while running
 * `npm run dev`. Development only: never part of the production bundle.
 */
import { useState, type ReactNode } from 'react';
import { useApi, type LessonSummary, type ThemeName } from '@shared/api';
import { getSeries } from '@shared/api/learner';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  ChoiceGroup,
  EmptyState,
  ErrorState,
  FactsRow,
  filterLessons,
  Illustration,
  InfoStrip,
  LanguageSwitch,
  LessonCard,
  LessonFilter,
  LessonHeaderPill,
  LessonTypeBadge,
  LoadingState,
  Message,
  PersonChip,
  PortalCard,
  Progress,
  ProgressSteps,
  StateChip,
  SuccessState,
  summariseStates,
  TagLine,
  TextField,
  TopicCard,
  YouTakePart,
  LESSON_TYPES,
  type LessonFilterValue,
} from '@shared/components';
import * as icons from '@shared/icons';
import { paths } from '@shared/router';
import { ListenBar, PageShell } from '@shared/shell';

const { Icon: _base, ...iconSet } = icons;
void _base;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="sb-stack" style={{ marginTop: 40 }}>
      <h2 className="sb-h2">{title}</h2>
      {children}
    </section>
  );
}

const SAMPLE: LessonSummary = {
  id: 'cp-child-staying-safe-4',
  seriesId: 'cp-child-staying-safe',
  position: 4,
  title: 'It is not my fault',
  summary: 'You did nothing wrong.',
  picture: { url: '/illustrations/child-protection/scenes/CPB-Child-lesson4.svg', alt: 'A child and a kind grandmother sit together' },
  language: 'en',
  type: 'watch',
  interactive: true,
  captions: true,
  readAlong: false,
  needsSound: true,
  length: null,
  pages: null,
};

export function KitchenSink() {
  const [theme, setTheme] = useState<ThemeName>('blue');
  const [quickExit, setQuickExit] = useState(false);
  const [filter, setFilter] = useState<LessonFilterValue>('all');
  const [who, setWho] = useState<'learner' | 'teacher' | 'other' | null>('learner');
  const [name, setName] = useState('');
  const series = useApi((signal) => getSeries('cp-parent-keeping-children-safe', { signal }), []);

  return (
    <PageShell title="Kitchen sink" theme={theme} backTo={paths.home()} quickExit={quickExit} listenSrc="/media/sample-audio.m4a">
      <h1 className="sb-h1">Kitchen sink</h1>
      <p className="sb-body sb-muted">Shared components against V3-Components. Development only.</p>
      <div className="sb-row" style={{ marginTop: 16, flexWrap: 'wrap' }}>
        <Button size="sm" variant="secondary" onClick={() => setTheme(theme === 'blue' ? 'agriculture' : 'blue')}>
          Theme: {theme}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setQuickExit(!quickExit)}>
          Quick exit: {quickExit ? 'on' : 'off'}
        </Button>
      </div>
      <ListenBar src="/media/sample-audio.m4a" />

      <Section title="Type">
        <p className="sb-h1">Screen title · 32 / 800 · Kushɛ! Ɔl tin fayn</p>
        <p className="sb-h2">Card title · 28 / 800</p>
        <p className="sb-h3">Topic title · 24 / 800</p>
        <p className="sb-body">Body and instructions · 18 / 400. Tap your name to carry on learning. Wi dae make u sensebod. ɛ ɔ ŋ Ɛ Ɔ Ŋ</p>
        <p className="sb-body" style={{ fontWeight: 600 }}>Semibold 600 · ɛ ɔ ŋ</p>
        <p className="sb-label">Label · 16 / 700 (never smaller) · ɛ ɔ ŋ</p>
      </Section>

      <Section title={`Icons (${Object.keys(iconSet).length})`}>
        <div style={{ display: 'flex', flexWrap: 'wrap' }}>
          {Object.entries(iconSet).map(([iconName, Glyph]) => (
            <div key={iconName} style={{ width: 120, margin: '0 8px 16px 0', textAlign: 'center' }}>
              <Badge size="lg">
                <Glyph size={38} />
              </Badge>
              <div className="sb-label" style={{ fontSize: 13, wordBreak: 'break-all' }}>
                {iconName.replace(/^Icon/, '')}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Buttons">
        <div className="sb-grid">
          <Button size="lg" icon={<icons.IconSave size={32} />}>Save and start learning</Button>
          <Button size="lg" className="is-pressed" icon={<icons.IconSave size={32} />}>Pressed</Button>
          <Button size="lg" working workingLabel="Saving your name…">Save and start learning</Button>
          <Button size="lg" notReady icon={<icons.IconPencil size={30} />}>Type your name first</Button>
          <Button variant="secondary" icon={<icons.IconSkip size={30} />}>Skip — learn as a guest</Button>
          <Button variant="listen" icon={<icons.IconListen size={34} />}>Listen to this page</Button>
          <Button variant="danger" icon={<icons.IconTrash size={30} />}>Remove Aminata’s name</Button>
          <Button variant="danger-outline" icon={<icons.IconTryAgain size={30} />}>Try again</Button>
          <Button variant="success" icon={<icons.IconArrowRight size={30} />}>Next question</Button>
          <ButtonLink to={paths.home()} variant="exit" icon={<icons.IconLeave size={28} />}>Leave this page</ButtonLink>
          <Button size="sm" icon={<icons.IconPlay size={26} />}>Small 56</Button>
          <div className="sb-row sb-row--stretch">
            <Button stacked variant="secondary" icon={<icons.IconBack10 size={42} />}>Back 10s</Button>
            <Button stacked icon={<icons.IconPause size={50} />}>Pause</Button>
            <Button stacked variant="secondary" icon={<icons.IconForward10 size={42} />}>Forward 10s</Button>
          </div>
        </div>
        <LanguageSwitch />
        <PersonChip name="Aminata" changeTo={paths.saveProgress()}>
          Learning as <strong>Aminata</strong>
        </PersonChip>
      </Section>

      <Section title="Cards">
        <div className="sb-grid">
          <PortalCard to="/" title="Primary school" description="Class 1 to Class 6" icon={<icons.IconPortalPrimary size={40} />} picture={{ url: '/pictures/portals/primary.svg', alt: 'A classroom' }} />
          <PortalCard to="/" theme="agriculture" title="Agriculture" description="Animals, crops and selling" icon={<icons.IconPortalAgriculture size={40} />} picture={{ url: '/pictures/portals/agriculture.svg', alt: 'A farm' }} />
          <Card tappable>
            <div className="sb-card__body sb-card__body--padded">Plain tappable card</div>
          </Card>
        </div>
        <div className="sb-grid sb-grid--4">
          <TopicCard to="/" state="started" title="Chickens and quail" done={1} total={5} icon={<icons.IconPortalAgriculture size={32} />} picture={{ url: '/illustrations/agriculture/scenes/chickens-feeding.svg', alt: '' }} tag={<TagLine type="watch" detail="12 videos" />} />
          <TopicCard to="/" state="not-started" title="Rabbits" detail="4 videos" icon={<icons.IconPortalAgriculture size={32} />} picture={{ url: '/illustrations/agriculture/scenes/rabbits-feeding.svg', alt: '' }} />
          <TopicCard to="/" state="finished" title="Milk and dairy cows" icon={<icons.IconPortalAgriculture size={32} />} picture={{ url: '/illustrations/agriculture/scenes/hand-milking.svg', alt: '' }} />
          <TopicCard state="not-in-bag" title="Crops" detail="Not in this bag yet. Ask your facilitator." icon={<icons.IconPortalAgriculture size={32} />} picture={{ url: '/illustrations/agriculture/scenes/crops-field.svg', alt: '' }} />
        </div>
      </Section>

      <Section title="Lesson types">
        <div className="sb-row" style={{ flexWrap: 'wrap' }}>
          {(Object.keys(LESSON_TYPES) as (keyof typeof LESSON_TYPES)[]).map((type) => (
            <span key={type} className="sb-row" style={{ marginBottom: 12 }}>
              <LessonTypeBadge type={type} />
              <TagLine type={type} detail="Lesson 1" />
            </span>
          ))}
        </div>
        <div className="sb-row" style={{ flexWrap: 'wrap' }}>
          <YouTakePart />
          <StateChip state="not-started" />
          <StateChip state="started" />
          <StateChip state="finished" />
          <StateChip state="not-in-bag" />
        </div>
        <LessonHeaderPill type="watch" detail="Lesson 1" />
        <FactsRow tag={SAMPLE} />
        <LessonFilter value={filter} onChange={setFilter} />
        <div className="sb-grid">
          <LessonCard lesson={SAMPLE} to={paths.lesson(SAMPLE.id)} state="not-started" />
          {series.data
            ? filterLessons(series.data.lessons, filter).map((lesson, index) => (
                <LessonCard key={lesson.id} lesson={lesson} to={paths.lesson(lesson.id)} state={index === 0 ? 'finished' : index === 1 ? 'started' : 'not-started'} current={index === 1} />
              ))
            : null}
        </div>
        {series.loading ? <LoadingState /> : null}
        {series.error ? <ErrorState error={series.error} onRetry={series.reload} /> : null}
      </Section>

      <Section title="Progress">
        <div className="sb-grid">
          <Progress done={1} total={5} />
          <Progress done={0} total={4} words="Not started · 4 videos" />
          <Progress done={5} total={5} />
        </div>
        <ProgressSteps states={['finished', 'started', 'not-started', 'not-started']} label="Lesson 1 finished. Lesson 2 started. Lessons 3 and 4 not started." />
        <p className="sb-label sb-muted">{summariseStates(['finished', 'started', 'not-started', 'not-started'])}</p>
      </Section>

      <Section title="Messages and states">
        <div className="sb-grid">
          <SuccessState>Your progress is saved in this bag, Aminata.</SuccessState>
          <Message tone="info" title="Good to know">Videos never play by themselves. Tap Play when you are ready.</Message>
          <EmptyState action={<ButtonLink to="/" fullWidth icon={<icons.IconBack size={28} />}>Back to Agriculture</ButtonLink>}>Crops videos are not in this bag. Ask your facilitator.</EmptyState>
          <ErrorState title="This video did not open" onRetry={() => undefined} />
          <LoadingState />
        </div>
        <InfoStrip />
      </Section>

      <Section title="Forms">
        <div className="sb-grid">
          <TextField label="Your name" placeholder="Type your name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="given-name" />
          <TextField label="Your name" defaultValue="" error="Type your name first." />
          <ChoiceGroup
            label="Who are you?"
            value={who}
            onChange={setWho}
            chosenNote="Chosen"
            options={[
              { value: 'learner', label: 'Learner', mark: <icons.IconPortalJss size={28} /> },
              { value: 'teacher', label: 'Teacher', mark: <icons.IconPortalPrimary size={28} /> },
              { value: 'other', label: 'Parent, farmer or other', mark: <icons.IconPerson size={28} /> },
            ]}
          />
        </div>
      </Section>

      <Section title="Illustration (lazy)">
        <Illustration src="child-protection/cast/fatmata" alt="Fatmata" width={160} height={200} />
      </Section>
    </PageShell>
  );
}
