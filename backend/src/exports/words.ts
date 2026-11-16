/*
 * One-time passwords for learner-data zips (DATA-EXPORT §6.1): plain short
 * English words and two digits, e.g. river-mango-seven-chalk-stone-42, made
 * with the system's random source. At least 50 bits: the number of words is
 * worked out from the size of the list.
 *
 * Deviation from the document, stated: it names a 2,048-word list with four
 * words; this list is smaller (about 500 easy words a facilitator can spell),
 * so five words are used. The strength is the same or better.
 */
import { randomInt } from 'node:crypto';

const RAW = `
able acre aunt baby back bake ball band bank barn base bath bead beam bean bear beat bell belt bend best bike bird blue boat body bold bone book boot born bowl
boys bread brick bring broom brown brush build bump bush busy cake calf call calm camp cane cape card care cart case cash cave chair chalk chart chest chief child
chin city clap class clay clean clear climb clock close cloth cloud coal coast coat cold comb cook cool corn cost count court cover crab crop cross crowd cup
dance dark date dawn deep deer desk dish dive dock door down draw dream dress drink drive drum dry duck dust each early earth east easy edge eight elbow empty
even every face fact fair fall farm fast feast feed fence field fifty fill find fine fire firm fish five flag flat floor flour flow fold food foot forest fork
form four free fresh friend frog front fruit full game gate gift girl give glad glass goat gold good grain grand grass great green grow guest guide hall hand
happy hard harp hat hawk head heal heap hear heart heat help herb herd hero high hill hold home honey hope horn horse host hour house huge hunt idea iron jar
join joke jump keep kettle kind king kite knee knot lake lamp land large last late laugh leaf lean learn left lemon lend less level lift light lime line lion
list live load loaf lock long look loud love lucky lunch made main make mango many map march mark market mat meal meat meet melon mend milk mill mind mint moon
more morning most mouse mouth move much mud music name near neat neck nest new next nice night nine noon north nose note nurse oak ocean offer often oil open
orange other oven over pack page paint pair palm pan paper park part pass path peace peak pear pen people pick piece pilot pine pipe place plain plan plant
plate play plum point pond pool port post pot pound pull pump pure push queen quick quiet rain raise reach read ready real rest rice rich ride right ring ripe
rise river road rock roof room root rope rose round row rule run safe sail salt same sand save scale school sea seat seed seven shade shape share sharp sheep
shelf shell shine ship shirt shoe shop short show side sign silk sing sister six size skill skin sky sleep slow small smile smoke snail soap soft soil song
soon sound soup south space speak spoon sport spring square stand star start stay steam stem step stick still stone stop store storm story street strong sugar
sun sweet swim table tail take talk tall task taste teach team ten tent thank thick thin think three thumb tide tie time tiny today tooth top town track trade
train tree trip true trust try tune turn twelve twin two uncle under until upon use valley very view visit voice wait walk wall warm wash watch water wave way
week well west wheat wheel white wide wild will wind window wing wise wish wood wool word work world write yard year yellow young zero
`;

export const WORDS: readonly string[] = [...new Set(RAW.split(/\s+/).filter((word) => /^[a-z]{2,7}$/.test(word)))];

const DIGIT_BITS = Math.log2(100);
export const WORD_COUNT = Math.max(4, Math.ceil((50 - DIGIT_BITS) / Math.log2(WORDS.length)));

export function passwordBits(): number {
  return WORD_COUNT * Math.log2(WORDS.length) + DIGIT_BITS;
}

export function generatePassword(): string {
  const parts: string[] = [];
  for (let i = 0; i < WORD_COUNT; i += 1) parts.push(WORDS[randomInt(WORDS.length)] as string);
  parts.push(String(randomInt(100)).padStart(2, '0'));
  return parts.join('-');
}
