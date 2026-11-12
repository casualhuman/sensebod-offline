/*
 * Child protection: Get help now (board: CPB-Help).
 *
 * The words come from the board, not from the API. Every contact on this
 * page is still a PLACEHOLDER in square brackets, exactly as on the board
 * (HANDOFF section 8): the content owner must confirm the real numbers and
 * places. Nothing here may be replaced by a guess, and nothing is a link to
 * dial, because no number is known yet.
 */
import type { ReactNode } from 'react';
import { Badge, ButtonLink, Card, Illustration, InfoStrip, ScenePicture } from '@shared/components';
import { IconError, IconHeart, IconHelp, IconHome, IconPerson, IconPortalChildProtection } from '@shared/icons';
import { paths } from '@shared/router';
import { useSession } from '@shared/session';
import { PageShell } from '@shared/shell';
import { Hero } from '../components';
import { IconPhone, IconPlace, IconTalk } from '../icons';
import { CHILD_PROTECTION } from '../lib';

const SCENES = '/illustrations/child-protection/scenes/';

/** A contact that is not confirmed yet: shown in brackets, never as a link. */
function Placeholder({ icon, children }: { icon: ReactNode; children: string }) {
  return (
    <span className="lrn-contact">
      {icon}
      <span>{children}</span>
    </span>
  );
}

function SectionTitle({ id, icon, danger, children }: { id: string; icon: ReactNode; danger?: boolean; children: string }) {
  return (
    <div className="lrn-media">
      <Badge tone={danger ? 'danger' : 'accent'} className={danger ? 'lrn-media__badge' : 'lrn-media__badge lrn-badge--tint-ring'}>
        {icon}
      </Badge>
      <h2 id={id} className={danger ? 'sb-h3 lrn-danger-text' : 'sb-h3'}>
        {children}
      </h2>
    </div>
  );
}

const TRUSTED: { scene: string; alt: string; label: string }[] = [
  {
    scene: 'CPB-Help-teacher',
    alt: 'Mr Koroma, the teacher, stands at the open school gate and waves; Ibrahim, with his school bag on his back, waves back as he walks in',
    label: 'Teacher',
  },
  {
    scene: 'CPB-Help-health',
    alt: 'Nurse Aminata, in her white cap and uniform, stands at the clinic door and waves hello while holding the hand of little Mariama, who smiles up at her',
    label: 'Health worker',
  },
  {
    scene: 'CPB-Help-trusted',
    alt: 'At home in the compound, Haja the grandmother sits on a bench with a cup and Abu sits beside her listening, while Ya Bintu, the women’s leader, stands and talks with them kindly',
    label: 'Parent, carer or community elder',
  },
];

export default function Help() {
  const { childProtectionAudience } = useSession();
  const portalPath = paths.portal(CHILD_PROTECTION);
  // Back returns to the lessons the reader came from, when that is known.
  const backTo = childProtectionAudience ? paths.group(CHILD_PROTECTION, childProtectionAudience) : portalPath;

  return (
    <PageShell title="Get help now" backTo={backTo} quickExit listenSrc={null}>
      <div className="sb-stack sb-stack--lg">
        <Hero
          title="Get help now"
          description="You are not alone. These people can help you."
          picture={{
            url: `${SCENES}CPB-Help-hero.svg`,
            alt: 'Mr Koroma, the teacher, sits on a bench outside the classroom and leans in to listen kindly while Fatmata, in her blue school uniform, tells him something',
          }}
          pictureShape="lesson"
          icon={<IconHelp size={42} />}
          listenSrc={null}
        />

        <div className="lrn-help-grid">
          <section aria-labelledby="lrn-help-danger" className="lrn-danger lrn-help-grid__wide">
            <div className="lrn-danger__head">
              <SectionTitle id="lrn-help-danger" icon={<IconError size={34} />} danger>
                If you are in danger now
              </SectionTitle>
            </div>
            <ul className="lrn-danger__list">
              <li>
                <span className="lrn-danger__mark" aria-hidden="true">
                  <IconHome size={28} />
                </span>
                <span>
                  <strong>Go to a safe place</strong> where there are people you trust.
                </span>
              </li>
              <li>
                <span className="lrn-danger__mark" aria-hidden="true">
                  <IconPerson size={28} />
                </span>
                <span>
                  <strong>Tell a grown-up you trust</strong> right away.
                </span>
              </li>
              <li>
                <span className="lrn-danger__mark" aria-hidden="true">
                  <IconPhone size={28} />
                </span>
                <span>
                  From a phone, <strong>call [Emergency number — confirm]</strong>.
                </span>
              </li>
            </ul>
          </section>

          <Card tappable large className="lrn-panel" aria-labelledby="lrn-help-line">
            <SectionTitle id="lrn-help-line" icon={<IconPhone size={34} />}>
              Child helpline
            </SectionTitle>
            <p className="sb-body lrn-gap-top">Call this number from a phone. Say you need help.</p>
            <div className="lrn-contact-box lrn-gap-top">
              <Placeholder icon={<IconPhone size={30} />}>[Child helpline number — confirm]</Placeholder>
            </div>
            <p className="sb-label lrn-regular sb-muted lrn-gap-top">This bag has no phone. Ask a grown-up you trust to help you call.</p>
          </Card>

          <Card tappable large aria-labelledby="lrn-help-fsu">
            <ScenePicture
              picture={{
                url: `${SCENES}CPB-Help-fsu.svg`,
                alt: 'Officer Sesay of the police Family Support Unit, in a blue beret and light blue uniform shirt, sits at his desk and kindly welcomes Kadiatu, who sits on a chair to talk with him',
              }}
            />
            <div className="lrn-panel">
              <SectionTitle id="lrn-help-fsu" icon={<IconPortalChildProtection size={32} />}>
                Police Family Support Unit
              </SectionTitle>
              <p className="sb-body lrn-gap-top">Go to the police station. Ask for the Family Support Unit.</p>
              <div className="lrn-contact-box lrn-gap-top">
                <Placeholder icon={<IconPhone size={28} />}>[Family Support Unit contact — confirm]</Placeholder>
                <Placeholder icon={<IconPlace size={28} />}>[Nearest police station — confirm]</Placeholder>
              </div>
            </div>
          </Card>

          <Card tappable large className="lrn-panel lrn-help-grid__wide" aria-labelledby="lrn-help-trust">
            <SectionTitle id="lrn-help-trust" icon={<IconTalk size={34} />}>
              Talk to a teacher or health worker you trust
            </SectionTitle>
            <p className="sb-body lrn-gap-top">Go and find one of these people today:</p>
            <ul className="lrn-trusted lrn-gap-top">
              {TRUSTED.map((person) => (
                <li key={person.scene} className="lrn-trusted__item">
                  <span className="sb-picture">
                    <Illustration className="sb-picture__img" src={`${SCENES}${person.scene}.svg`} alt={person.alt} />
                  </span>
                  <span className="lrn-trusted__label">{person.label}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <InfoStrip icon={<IconHeart size={36} />}>
          Telling someone is brave. <strong>It is not your fault.</strong>
        </InfoStrip>

        <ButtonLink to={portalPath} variant="secondary" fullWidth icon={<IconPortalChildProtection size={30} />} className="lrn-narrow">
          Back to Child protection
        </ButtonLink>
      </div>
    </PageShell>
  );
}
