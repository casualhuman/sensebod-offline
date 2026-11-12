/*
 * What follows the lesson list on a Child protection page, per audience
 * (boards: CPB-Child "Talk to someone you trust", CPB-Parent "Worried about
 * a child?", CPB-Elder "What to do if a child tells you").
 *
 * The words are fixed by the boards and are not lesson content, so they live
 * here. Bracketed text is a placeholder that the content owner must confirm;
 * it is shown exactly as on the board and never replaced by a guess.
 */
import type { ReactNode } from 'react';
import type { Group } from '@shared/api';
import { Badge, ButtonLink, Card, Illustration, InfoStrip } from '@shared/components';
import { IconHeart, IconHelp, IconPortalChildProtection } from '@shared/icons';
import { paths } from '@shared/router';
import { HelpCard } from '../components';
import { IconAudienceParent, IconEar, IconFlag, IconPlace } from '../icons';

const SCENES = 'child-protection/scenes/';

/** CPB-Child: three trusted grown-ups, each at their own door. Described once, as one picture. */
const TRUST_ALT =
  'Three grown-ups you can trust, each in their own place: Nurse Aminata in her white uniform and cap waves at the clinic door, Mr Koroma the teacher welcomes you at the school door, and Haja the grandmother smiles at the door of her home holding a cup';

function TrustSection() {
  return (
    <Card current large className="lrn-trust" aria-labelledby="lrn-trust">
      <div className="lrn-trust__pictures" role="img" aria-label={TRUST_ALT}>
        <span className="sb-picture"><Illustration className="sb-picture__img" src={`${SCENES}CPB-Child-trust-clinic`} alt="" /></span>
        <span className="sb-picture"><Illustration className="sb-picture__img" src={`${SCENES}CPB-Child-trust-school`} alt="" /></span>
        <span className="sb-picture"><Illustration className="sb-picture__img" src={`${SCENES}CPB-Child-trust-home`} alt="" /></span>
      </div>
      <div className="sb-card__body">
        <Badge size="lg" overlap>
          <IconAudienceParent size={40} />
        </Badge>
        <h2 id="lrn-trust" className="sb-h2 lrn-gap-top-sm">
          Talk to someone you trust
        </h2>
        <p className="sb-body lrn-gap-top-sm">If something feels wrong, tell a grown-up you trust. A parent, a teacher, a health worker or an elder.</p>
        <ButtonLink to={paths.help()} variant="danger" size="lg" fullWidth icon={<IconHelp size={30} />} className="lrn-gap-top">
          Get help now
        </ButtonLink>
      </div>
    </Card>
  );
}

const ELDER_STEPS: { title: string; text: string; icon: ReactNode }[] = [
  { title: 'Listen', text: 'Stay calm. Let the child speak. Do not rush them.', icon: <IconEar size={38} /> },
  { title: 'Believe', text: 'Say: “I believe you. It is not your fault.”', icon: <IconHeart size={38} /> },
  { title: 'Keep them safe', text: 'Make sure the child is safe now. Do not promise to keep it a secret.', icon: <IconPortalChildProtection size={38} /> },
  { title: 'Report', text: 'Tell the right people soon: [Local referral contact — confirm].', icon: <IconFlag size={38} /> },
];

function ElderSteps() {
  return (
    <Card current large className="lrn-panel" aria-labelledby="lrn-steps">
      <h2 id="lrn-steps" className="sb-h2">
        What to do if a child tells you
      </h2>
      <p className="sb-body sb-muted">Four steps. Do them in this order.</p>
      <ol className="lrn-steps">
        {ELDER_STEPS.map((step, index) => (
          <li key={step.title} className="lrn-steps__item">
            <span className="lrn-steps__mark" aria-hidden="true">
              <span className="lrn-steps__badge">
                {step.icon}
                <span className="lrn-steps__number">{index + 1}</span>
              </span>
            </span>
            <span className="lrn-steps__words">
              <span className="lrn-steps__title">
                <span className="sb-visually-hidden">Step {index + 1}: </span>
                {step.title}
              </span>
              <span className="lrn-steps__text">{step.text}</span>
            </span>
          </li>
        ))}
      </ol>
      <ButtonLink to={paths.help()} variant="secondary" fullWidth icon={<IconPlace size={30} />} className="lrn-gap-top">
        See where to report
      </ButtonLink>
    </Card>
  );
}

/**
 * TODO(stream-1): the three audiences are recognised by the seeded group ids
 * (API-CONTRACT section 7). The contract does not fix them; any other
 * audience gets the general "Need help now?" card. See docs/team/REQUESTS.md.
 */
export function AudienceExtras({ group }: { group: Pick<Group, 'id'> }) {
  if (group.id === 'cp-child') {
    return (
      <>
        <TrustSection />
        <InfoStrip icon={<IconHeart size={36} />}>
          Telling is brave. <strong>It is never your fault.</strong>
        </InfoStrip>
      </>
    );
  }
  if (group.id === 'cp-parent') return <HelpCard title="Worried about a child?" text="See who can help today." />;
  if (group.id === 'cp-elder') {
    return (
      <>
        <ElderSteps />
        <HelpCard title="A child needs help now?" text="See who to go to today." />
      </>
    );
  }
  return <HelpCard title="Need help now?" text="See who can help you today." />;
}
