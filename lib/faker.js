/**
 * DevFill lightweight fake-data generator.
 * No external dependencies. Exposed as `window.DevFillFaker`.
 *
 * Everything here is intentionally simple (small word lists + string
 * templates) rather than statistically "real" fake data - the goal is
 * forms that look plausible during development, not a marketing demo.
 */
(function (root) {
  'use strict';

  const FIRST_NAMES = [
    'James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda',
    'David', 'Elizabeth', 'William', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica',
    'Thomas', 'Sarah', 'Charles', 'Karen', 'Chris', 'Nancy', 'Daniel', 'Lisa',
    'Matthew', 'Betty', 'Anthony', 'Margaret', 'Mark', 'Sandra', 'Priya', 'Wei',
    'Aiko', 'Fatima', 'Liam', 'Olivia', 'Noah', 'Emma', 'Ava', 'Sofia'
  ];

  const LAST_NAMES = [
    'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
    'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
    'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson',
    'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker',
    'Chen', 'Nguyen', 'Kim', 'Patel', 'Khan'
  ];

  const STREET_NAMES = [
    'Maple', 'Oak', 'Pine', 'Cedar', 'Elm', 'Washington', 'Lake', 'Hill',
    'Sunset', 'Main', 'Park', 'Highland', 'Church', 'Willow', 'Chestnut', 'Ridge'
  ];

  const STREET_TYPES = ['St', 'Ave', 'Blvd', 'Rd', 'Ln', 'Dr', 'Ct', 'Way'];

  const CITIES = [
    'Springfield', 'Franklin', 'Georgetown', 'Clinton', 'Salem', 'Fairview',
    'Riverside', 'Greenville', 'Bristol', 'Manchester', 'Arlington', 'Ashland',
    'Portland', 'Austin', 'Denver', 'Raleigh'
  ];

  const STATES = [
    ['Alabama', 'AL'], ['Alaska', 'AK'], ['Arizona', 'AZ'], ['California', 'CA'],
    ['Colorado', 'CO'], ['Florida', 'FL'], ['Georgia', 'GA'], ['Illinois', 'IL'],
    ['New York', 'NY'], ['Ohio', 'OH'], ['Oregon', 'OR'], ['Texas', 'TX'],
    ['Washington', 'WA'], ['Massachusetts', 'MA'], ['Nevada', 'NV']
  ];

  const COUNTRIES = [
    'United States', 'Canada', 'United Kingdom', 'Germany', 'France',
    'Australia', 'Japan', 'Brazil', 'India', 'Netherlands'
  ];

  const COMPANY_PREFIXES = ['Nova', 'Blue', 'Summit', 'Bright', 'North', 'Silver', 'Rapid', 'Clear', 'Vertex', 'Union'];
  const COMPANY_SUFFIXES = ['Labs', 'Systems', 'Group', 'Works', 'Solutions', 'Partners', 'Studio', 'Technologies', 'Co', 'Industries'];
  const JOB_TITLES = [
    'Software Engineer', 'Product Manager', 'Account Executive', 'Designer',
    'Marketing Manager', 'Operations Lead', 'Data Analyst', 'Customer Success Manager',
    'QA Engineer', 'DevOps Engineer'
  ];

  const EMAIL_DOMAINS = ['example.com', 'example.org', 'example.net', 'mail.test'];

  const LOREM_WORDS = (
    'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod ' +
    'tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam ' +
    'quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo ' +
    'consequat duis aute irure in reprehenderit voluptate velit esse cillum ' +
    'eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident'
  ).split(' ');

  // ---- helpers ----------------------------------------------------------

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function pad(n, len) {
    return String(n).padStart(len, '0');
  }

  function slugify(str) {
    return str
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '');
  }

  // ---- generators ---------------------------------------------------------

  function firstName() {
    return pick(FIRST_NAMES);
  }

  function lastName() {
    return pick(LAST_NAMES);
  }

  function fullName() {
    return `${firstName()} ${lastName()}`;
  }

  function username(name) {
    const base = name ? slugify(name) : slugify(firstName() + lastName());
    return `${base}${randInt(1, 999)}`;
  }

  function email(name) {
    const base = name ? slugify(name) : slugify(firstName()) + '.' + slugify(lastName());
    return `${base}${randInt(1, 99)}@${pick(EMAIL_DOMAINS)}`;
  }

  function phone() {
    return `(${randInt(200, 989)}) ${randInt(200, 989)}-${pad(randInt(0, 9999), 4)}`;
  }

  function streetAddress() {
    return `${randInt(100, 9999)} ${pick(STREET_NAMES)} ${pick(STREET_TYPES)}`;
  }

  function addressLine2() {
    return Math.random() > 0.5 ? `Apt ${randInt(1, 400)}` : `Suite ${randInt(100, 999)}`;
  }

  function city() {
    return pick(CITIES);
  }

  function stateName() {
    return pick(STATES)[0];
  }

  function stateAbbr() {
    return pick(STATES)[1];
  }

  function zip() {
    return pad(randInt(0, 99999), 5);
  }

  function country() {
    return pick(COUNTRIES);
  }

  function company() {
    return `${pick(COMPANY_PREFIXES)} ${pick(COMPANY_SUFFIXES)}`;
  }

  function jobTitle() {
    return pick(JOB_TITLES);
  }

  function website(name) {
    const base = name ? slugify(name) : slugify(company());
    return `https://www.${base}.com`;
  }

  function password() {
    const symbols = '!@#$%^&*';
    return (
      pick(FIRST_NAMES) +
      randInt(10, 99) +
      pick(symbols.split(''))
    );
  }

  function sentence(wordCount) {
    const count = wordCount || randInt(6, 12);
    const words = [];
    for (let i = 0; i < count; i++) words.push(pick(LOREM_WORDS));
    const text = words.join(' ');
    return text.charAt(0).toUpperCase() + text.slice(1) + '.';
  }

  function paragraph(sentenceCount) {
    const count = sentenceCount || randInt(3, 5);
    const sentences = [];
    for (let i = 0; i < count; i++) sentences.push(sentence());
    return sentences.join(' ');
  }

  function number(min, max) {
    return randInt(min !== undefined ? min : 0, max !== undefined ? max : 100);
  }

  function boolean() {
    return Math.random() > 0.5;
  }

  function isoDate(daysFromNowMin, daysFromNowMax) {
    const days = randInt(daysFromNowMin, daysFromNowMax);
    const d = new Date();
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
  }

  function pastDate() {
    return isoDate(-3650, -1);
  }

  function futureDate() {
    return isoDate(1, 365);
  }

  function birthDate() {
    return isoDate(-29200, -6570); // roughly 18-80 years ago
  }

  function time() {
    return `${pad(randInt(0, 23), 2)}:${pad(randInt(0, 59), 2)}`;
  }

  function datetimeLocal() {
    return `${futureDate()}T${time()}`;
  }

  function month() {
    const d = new Date();
    d.setMonth(d.getMonth() + randInt(-6, 6));
    return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}`;
  }

  function week() {
    const d = new Date();
    d.setDate(d.getDate() + randInt(-90, 90));
    const start = new Date(d.getFullYear(), 0, 1);
    const weekNum = Math.ceil((((d - start) / 86400000) + start.getDay() + 1) / 7);
    return `${d.getFullYear()}-W${pad(weekNum, 2)}`;
  }

  function color() {
    return '#' + pad(randInt(0, 0xffffff).toString(16), 6);
  }

  function age() {
    return randInt(18, 80);
  }

  function creditCard() {
    let digits = '';
    for (let i = 0; i < 16; i++) digits += randInt(0, 9);
    return digits.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
  }

  function url() {
    return website();
  }

  root.DevFillFaker = {
    pick, randInt,
    firstName, lastName, fullName,
    username, email, phone,
    streetAddress, addressLine2, city, stateName, stateAbbr, zip, country,
    company, jobTitle, website, url,
    password, sentence, paragraph,
    number, boolean,
    pastDate, futureDate, birthDate, time, datetimeLocal, month, week,
    color, age, creditCard
  };
})(typeof window !== 'undefined' ? window : this);
