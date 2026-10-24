import "server-only";

export type Quote = { text: string; author: string };
export type PepTalk = { title: string; text: string };

export const QUOTES: Quote[] = [
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { text: "Stay hungry. Stay foolish.", author: "Steve Jobs" },
  {
    text: "We are what we repeatedly do. Excellence, then, is not an act, but a habit.",
    author: "Will Durant",
  },
  { text: "The journey of a thousand miles begins with one step.", author: "Lao Tzu" },
  {
    text: "The best time to plant a tree was 20 years ago. The second best time is now.",
    author: "Proverb",
  },
  { text: "Fall seven times, stand up eight.", author: "Japanese proverb" },
  { text: "Be not afraid of going slowly; be afraid only of standing still.", author: "Chinese proverb" },
  { text: "You miss 100% of the shots you don't take.", author: "Wayne Gretzky" },
  { text: "Hard work beats talent when talent doesn't work hard.", author: "Tim Notke" },
  { text: "Discipline is the bridge between goals and accomplishment.", author: "Jim Rohn" },
  { text: "Motivation is what gets you started. Habit is what keeps you going.", author: "Jim Ryun" },
  { text: "Start where you are. Use what you have. Do what you can.", author: "Arthur Ashe" },
  { text: "A year from now you may wish you had started today.", author: "Karen Lamb" },
  { text: "Dream big and dare to fail.", author: "Norman Vaughan" },
  {
    text: "Far better is it to dare mighty things, to win glorious triumphs, even though checkered by failure.",
    author: "Theodore Roosevelt",
  },
  {
    text: "Nothing in the world is worth having or worth doing unless it means effort, pain, difficulty.",
    author: "Theodore Roosevelt",
  },
  { text: "Well done is better than well said.", author: "Benjamin Franklin" },
  { text: "Lost time is never found again.", author: "Benjamin Franklin" },
  {
    text: "Waste no more time arguing about what a good man should be. Be one.",
    author: "Marcus Aurelius",
  },
  {
    text: "The impediment to action advances action. What stands in the way becomes the way.",
    author: "Marcus Aurelius",
  },
  { text: "We suffer more often in imagination than in reality.", author: "Seneca" },
  {
    text: "It is not that we have a short time to live, but that we waste a lot of it.",
    author: "Seneca",
  },
  {
    text: "First say to yourself what you would be; and then do what you have to do.",
    author: "Epictetus",
  },
  { text: "No man is free who is not master of himself.", author: "Epictetus" },
  { text: "Act as if what you do makes a difference. It does.", author: "William James" },
  { text: "What you do today can improve all your tomorrows.", author: "Ralph Marston" },
  { text: "Everything you've ever wanted is on the other side of fear.", author: "George Addair" },
];

export const PEP_TALKS: PepTalk[] = [
  {
    title: "Just start",
    text: "You don't need the perfect plan, the perfect mood, or the perfect day. You need five minutes and the decision to begin. Open the book. Write the first line. Put on your shoes. The hardest part of almost anything is the first move, and once you make it, momentum starts doing some of the work for you. Start small, start messy, but start today.",
  },
  {
    title: "Progress, not perfection",
    text: "Nobody gets it right the first time. Every person you admire has a pile of failed attempts behind them that you never see. Today isn't about being flawless. It's about being one step further than yesterday. Do the thing badly if you have to. Badly done beats perfectly imagined, every single time.",
  },
  {
    title: "Your future self is watching",
    text: "Somewhere ahead of you is a version of you who either did the work or didn't. That person is built from choices like the one in front of you right now. You don't have to be heroic. You just have to keep showing up. Make a decision today that future you will thank you for.",
  },
  {
    title: "Hard days count too",
    text: "Some days the energy just isn't there. That's normal, and it doesn't mean you're failing. On hard days, lower the bar but don't drop it. Do the smallest version of your habit. Ten minutes instead of an hour. One page instead of a chapter. Keeping the chain alive matters more than how long each link is.",
  },
  {
    title: "Comparison steals your focus",
    text: "Someone else will always look further ahead. You're seeing their highlight reel while living your behind-the-scenes. Their timeline isn't yours. The only fair comparison is you versus who you were last month. Look at that gap, and give yourself credit for it, then go make it a little bigger.",
  },
  {
    title: "Discipline is freedom",
    text: "Motivation comes and goes like the weather. Discipline is the roof you build so the weather stops deciding your day. Every time you keep a promise to yourself, even a tiny one, you prove that you can be trusted. That trust becomes confidence, and confidence makes the next promise easier to keep.",
  },
  {
    title: "Fear is a signal, not a stop sign",
    text: "That nervous feeling before something new isn't proof you can't do it. Often it's proof that it matters to you. You can feel afraid and act anyway. Courage was never the absence of fear; it's moving forward with it riding along. Take the step. Your confidence will catch up.",
  },
  {
    title: "Rest is part of the work",
    text: "Pushing hard is good, but running on empty isn't a strategy. Sleep, food, a walk outside, time with people you love: these aren't distractions from your goals, they're what keep you able to chase them. Recover on purpose today so you can come back stronger tomorrow.",
  },
  {
    title: "Small wins add up",
    text: "One percent better each day doesn't feel like much. You won't notice it this week, maybe not this month. But small improvements compound quietly until one day you look back and barely recognise how far you've come. Win today in a small way. That's how big results are actually built.",
  },
  {
    title: "You've done hard things before",
    text: "Think back to something you once thought you couldn't handle, and handled anyway. You're still that person. Whatever is in front of you today, you have more evidence than you think that you can get through it. Take a breath, take the next step, and trust the version of you who has already proved it.",
  },
];

/** Days since the Unix epoch for a YYYY-MM-DD calendar date. */
function dayNumber(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

function pick<T>(items: T[], day: number, shift: number) {
  const n = items.length;
  return items[(((day + shift) % n) + n) % n];
}

/**
 * Quote and pep talk for a calendar day. Everyone gets the same pick on the same
 * date; `shift` steps through the list when the user asks for another one.
 */
export function getDaily(date: string, quoteShift = 0, talkShift = 0) {
  const day = dayNumber(date);
  return {
    date,
    quote: pick(QUOTES, day, quoteShift),
    pepTalk: pick(PEP_TALKS, day, talkShift),
  };
}

export type Daily = ReturnType<typeof getDaily>;
