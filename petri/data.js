// Petri dish content: communities, Where stops, When windows, Johnson limit, threats.

export const COMMUNITIES = [
  { id: 'cohort', name: 'your cohort', yours: true, color: '--c-cohort' },
  { id: 'studio', name: 'your studio', yours: true, color: '--c-studio' },
  { id: 'market', name: 'a community you are not in', yours: false, color: '--ink-2' },
];

// The app's Where steps. A live record stores your own phone's GPS position, so live records count by radio alone.
export const BOUNDARIES = [
  { id: 'room', label: 'room', d: 10, fuzz: 1.9, kind: 'signal', tech: 'Bluetooth signal strength', built: true,
    says: 'A direct signal of −80 dBm or more.',
    not: 'Not metres. Published measurements put the spread of signal strength in a crowd at 16.5 dB, and a live relay or a directional antenna far away can present the signal of a phone in the room.' },
  { id: 'building', label: 'building', d: 210, kind: 'route', tech: 'Bluetooth signal strength and relay through other phones', built: true,
    says: 'A weaker direct signal, or a beacon relayed over up to seven hops.',
    not: 'A hop count is the length of a route, not a distance, and any relay can set it.' },
  { id: 'city', label: 'city', d: 25000, kind: 'place', tech: 'the GPS position stored with a cast', built: true,
    says: 'Someone who posted within 25 km of where your phone is now. In the dish, every beacon has posted its position within the When window.',
    not: 'The position is a claim by whoever posted. Checks against DePIN, FOAM and Witness are shown in the app, and none is made yet.' },
  { id: 'earth', label: 'Earth', d: Infinity, kind: 'graph', tech: 'the social graph, over the internet', built: true,
    says: 'Everyone, wherever their records were made.',
    not: 'No radio or place evidence at all.' },
];

export const WHEN = [
  { id: 'now', label: 'now' },
  { id: 'hours', label: 'hours' },
  { id: 'days', label: 'days' },
  { id: 'weeks', label: 'weeks' },
];

export const JOHNSON = {
  title: 'Johnson limit',
  states: { same: 'repairs to one room', list: 'on the short list', apart: 'too different to repair' },
};

export const THREATS = [
  { id: 'keys', label: 'Many keys, one hand',
    brings: 'Modified software that signs as several identities from one device.',
    shows: 'Six identities on one spot.',
    affects: 'Each key adds a signed sighting and inflates a count.',
    limit: 'Count each known group once. That needs to know who controls which key, and the records do not say.',
    open: 'In a test of the current counting rule, three keys in one hand earned three credited epochs.' },
  { id: 'relay', label: 'A relay',
    brings: 'Two cooperating radios, one near you and one far away.',
    shows: 'Far phones appear inside the room boundary.',
    affects: 'A fresh, signed exchange looks local. The position stored with it is your own phone\'s, so it cannot reveal the relay.',
    limit: 'Only a measured distance could bound it. Freshness, signatures, hop marks and GPS positions do not.',
    open: 'No relay has been tested over real radios here.' },
  { id: 'account', label: 'A borrowed account',
    brings: 'Credentials, or an account whose owner cooperates.',
    shows: 'A member you know, with the device in another hand.',
    affects: 'Whatever trust that name had earned.',
    limit: 'Binding keys to accounts, with revocation and recovery. Proposed, not built.',
    open: 'Today the id in an exchange is a claim, so nothing needs to be stolen.' },
  { id: 'insiders', label: 'People in the room',
    brings: 'Willing people with access, time and real contacts.',
    shows: 'A tight group whose members vouch for one another.',
    affects: 'Valid records from separate, real people.',
    limit: 'Rosters, scoped badges and independent witnesses add evidence, at a cost in privacy.',
    open: 'Friends who travel together look the same. Correlation is not collusion.' },
  { id: 'history', label: 'A manufactured history',
    brings: 'Time: a group that builds a record over weeks.',
    shows: 'A dense web among the group.',
    affects: 'A history that resembles a real one.',
    limit: 'Weigh only histories that were corroborated separately, and test against groups that adapt.',
    open: 'Unproven. This is the hypothesis the project most needs to test.' },
  { id: 'forged', label: 'A made-up log',
    brings: 'A list of who was probably there, with no radio in the room.',
    shows: 'An outsider beyond the Johnson limit.',
    affects: 'Nothing: the list is too far from the room record to be repaired into it.',
    limit: 'The Johnson limit is the ceiling of that repair. A list that guesses enough of the room is repaired like an honest log.',
    open: 'Repair reads logs. It says nothing about how a log was heard, so a relay or a borrowed phone still passes.' },
];

export const COPY = { simulated: 'Simulated gathering with invented people.', you: 'you', epoch: 'epoch' };
