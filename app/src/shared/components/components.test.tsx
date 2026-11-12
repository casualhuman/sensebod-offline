import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { LessonSummary } from '../api/types';
import { IconSave } from '../icons';
import {
  Button,
  ChoiceGroup,
  ErrorState,
  FactsRow,
  filterLessons,
  formatLength,
  formatPages,
  LessonCard,
  LessonFilter,
  lessonActionLabel,
  Message,
  Progress,
  StateChip,
  summariseStates,
  TextField,
  TopicCard,
} from './index';

const lesson: LessonSummary = {
  id: 'l4',
  seriesId: 's',
  position: 4,
  title: 'It is not my fault',
  summary: 'You did nothing wrong.',
  picture: null,
  language: 'en',
  type: 'watch',
  interactive: true,
  captions: true,
  readAlong: false,
  needsSound: true,
  length: null,
  pages: null,
};

describe('Button', () => {
  it('is a labelled button with a hidden icon', () => {
    const onClick = vi.fn();
    render(
      <Button icon={<IconSave />} onClick={onClick}>
        Save and start learning
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save and start learning' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('ignores taps while working, and says what it is doing', () => {
    const onClick = vi.fn();
    render(
      <Button working workingLabel="Saving your name…" onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Saving your name…' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('is disabled when not ready', () => {
    render(<Button notReady>Type your name first</Button>);
    expect(screen.getByRole('button', { name: 'Type your name first' })).toBeDisabled();
  });
});

describe('lesson type rules', () => {
  it('names the main button from the data tag', () => {
    expect(lessonActionLabel({ type: 'watch', interactive: false })).toBe('Watch video');
    expect(lessonActionLabel({ type: 'watch', interactive: true })).toBe('Watch and answer');
    expect(lessonActionLabel({ type: 'listen', interactive: false })).toBe('Play audio');
    expect(lessonActionLabel({ type: 'read', interactive: false })).toBe('Read');
    expect(lessonActionLabel({ type: 'try', interactive: true })).toBe('Start');
    expect(lessonActionLabel({ type: 'check', interactive: true })).toBe('Start the quiz');
  });

  it('never invents a length or a page count', () => {
    expect(formatLength(null)).toBe('[length]');
    expect(formatLength(102)).toBe('1:42');
    expect(formatLength(5)).toBe('0:05');
    expect(formatPages(null)).toBe('[pages] pages');
    expect(formatPages(1)).toBe('1 page');
  });

  it('draws the facts row from the tag', () => {
    render(<FactsRow tag={lesson} />);
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(['Length: [length]', 'Needs sound', 'Captions']);
  });

  it('shows pages and Read along for a Read lesson', () => {
    render(<FactsRow tag={{ ...lesson, type: 'read', captions: false, needsSound: false, readAlong: true, pages: 3 }} />);
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['3 pages', 'Read along']);
  });
});

describe('LessonCard', () => {
  it('follows the card anatomy and is one link', () => {
    render(<LessonCard lesson={lesson} to="/lesson/l4" state="not-started" />);
    const card = screen.getByRole('link');
    expect(card).toHaveAttribute('href', '/lesson/l4');
    const text = card.textContent ?? '';
    const order = ['Watch · Lesson 4', 'You take part', 'Not started', 'It is not my fault', '[length]', 'Watch and answer'];
    const positions = order.map((part) => text.indexOf(part));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(within(card).queryByRole('button')).toBeNull();
  });

  it('labels the quiz and uses the outlined button when finished', () => {
    render(<LessonCard lesson={{ ...lesson, type: 'check', position: null, interactive: true, title: 'Check what you learned' }} to="/lesson/q" state="finished" />);
    const card = screen.getByRole('link');
    expect(card).toHaveTextContent('Check · Quiz');
    expect(card).toHaveTextContent('Finished');
    expect(card.querySelector('.sb-btn--secondary')).toHaveTextContent('Start the quiz');
  });
});

describe('LessonFilter', () => {
  it('offers All, Watch, Listen, Read and Try it, with All pressed first', () => {
    const onChange = vi.fn();
    render(<LessonFilter value="all" onChange={onChange} />);
    const group = screen.getByRole('group', { name: 'Show lessons by type' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['All', 'Watch', 'Listen', 'Read', 'Try it']);
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'true');
    expect(buttons[1]).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(buttons[3] as HTMLElement);
    expect(onChange).toHaveBeenCalledWith('read');
  });

  it('keeps the quiz at the end whatever the filter', () => {
    const lessons = [{ type: 'watch' }, { type: 'listen' }, { type: 'check' }];
    expect(filterLessons(lessons, 'all')).toHaveLength(3);
    expect(filterLessons(lessons, 'listen')).toEqual([{ type: 'listen' }, { type: 'check' }]);
  });
});

describe('cards and state', () => {
  it('says the state in words', () => {
    render(
      <>
        <StateChip state="started" />
        <StateChip state="not-in-bag" />
      </>,
    );
    expect(screen.getByText('Started')).toBeInTheDocument();
    expect(screen.getByText('Not in bag')).toBeInTheDocument();
  });

  it('does not link a topic that is not in the bag', () => {
    render(<TopicCard to="/x" state="not-in-bag" title="Crops" detail="Not in this bag yet. Ask your facilitator." icon={null} picture={null} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Crops').closest('[aria-disabled="true"]')).not.toBeNull();
  });

  it('puts progress in words first', () => {
    render(<TopicCard to="/x" state="started" title="Chickens and quail" done={1} total={5} icon={null} picture={null} />);
    expect(screen.getByRole('link')).toHaveTextContent('1 of 5 done');
    expect(screen.getByRole('img', { name: '1 of 5 lessons done' })).toBeInTheDocument();
  });

  it('describes progress', () => {
    render(<Progress done={0} total={4} />);
    expect(screen.getByText('Not started')).toBeInTheDocument();
    expect(summariseStates(['finished', 'started', 'not-started', 'not-started'])).toBe('1 finished · 1 started · 2 to go');
  });
});

describe('messages', () => {
  it('announces errors and offers Try again', () => {
    const retry = vi.fn();
    render(<ErrorState title="This video did not open" onRetry={retry} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('This video did not open');
    expect(alert).toHaveTextContent('Nothing is lost');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
  });

  it('uses a polite status for other messages', () => {
    render(
      <Message tone="success" title="Saved">
        Your progress is saved in this bag.
      </Message>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });
});

describe('forms', () => {
  it('labels the input and links the error to it', () => {
    render(<TextField label="Your name" error="Type your name first." />);
    const input = screen.getByLabelText('Your name');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Type your name first.');
    expect(input.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id);
  });

  it('marks the chosen row with a state and words, not colour alone', () => {
    const onChange = vi.fn();
    render(
      <ChoiceGroup
        label="Who are you?"
        value="teacher"
        onChange={onChange}
        chosenNote="Chosen"
        options={[
          { value: 'learner', label: 'Learner' },
          { value: 'teacher', label: 'Teacher' },
        ]}
      />,
    );
    const radios = within(screen.getByRole('radiogroup', { name: 'Who are you?' })).getAllByRole('radio');
    expect(radios[1]).toHaveAttribute('aria-checked', 'true');
    expect(radios[1]).toHaveTextContent('Chosen');
    fireEvent.click(radios[0] as HTMLElement);
    expect(onChange).toHaveBeenCalledWith('learner');
  });
});
