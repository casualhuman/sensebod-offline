/*
 * Stand-in pictures for the school subjects: a small collection per subject so
 * lessons do not all look the same, and so the admin has something to choose
 * from under "School" in the picture gallery. Simple drawings, to be replaced
 * when the real subject artwork is delivered. Files: public/pictures/subjects/.
 */
import type { Picture } from '../../src/shared/api/types.ts';

export const SUBJECT_PICTURES: Record<string, Picture[]> = {
  'English Language': [
    { url: '/pictures/subjects/english-letters.svg', alt: "An open book with the letters A, B and C above it and a pencil beside it" },
    { url: '/pictures/subjects/english-speaking.svg', alt: "Two children talk to each other; each has a speech bubble" },
    { url: '/pictures/subjects/english-writing.svg', alt: "A hand writes a line of words with a pencil in an exercise book" },
    { url: '/pictures/subjects/english-story.svg', alt: "A story book open at a picture of a house, a tree and the moon and stars" },
  ],
  'Mathematics': [
    { url: '/pictures/subjects/maths-sums.svg', alt: "A slate that says 2 plus 3 equals 5, with counting stones under it" },
    { url: '/pictures/subjects/maths-shapes.svg', alt: "Four shapes in a row: a triangle, a square, a circle and a rectangle" },
    { url: '/pictures/subjects/maths-sharing.svg', alt: "A round loaf cut into four equal pieces, with one piece moved away, and four children waiting to share it" },
    { url: '/pictures/subjects/maths-counting.svg', alt: "Three blocks numbered 1, 2 and 3 stacked like steps, and a ruler" },
  ],
  'Science': [
    { url: '/pictures/subjects/science-experiment.svg', alt: "A glass flask with blue water, a young plant in a pot, and the sun" },
    { url: '/pictures/subjects/science-water.svg', alt: "Water goes round: the sun warms a river, a cloud forms, and rain falls back on the hills" },
    { url: '/pictures/subjects/science-electricity.svg', alt: "A light bulb shines; two wires join it to a battery" },
    { url: '/pictures/subjects/science-living.svg', alt: "Living things: a butterfly, a bird on a branch, a fish in the water and a green leaf" },
  ],
  'Social Studies': [
    { url: '/pictures/subjects/social-village.svg', alt: "A village: two houses, a tall tree and four people standing together" },
    { url: '/pictures/subjects/social-globe.svg', alt: "A globe of the world on a stand, with a small flag beside it" },
    { url: '/pictures/subjects/social-market.svg', alt: "A market stall with a striped roof; a seller stands behind baskets of oranges, peppers and greens" },
    { url: '/pictures/subjects/social-school.svg', alt: "A school building with a flag on a pole; three pupils walk to the door" },
  ],
  'Agricultural Science': [
    { url: '/pictures/subjects/agric-field.svg', alt: "A farm field with rows of young green plants, a hoe and the sun" },
    { url: '/pictures/subjects/agric-harvest.svg', alt: "A basket full of harvest: cassava, peppers, oranges and green leaves, next to a watering can" },
  ],
};
