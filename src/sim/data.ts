/** League data: clubs are based on real NBA cities and colours but carry no team nicknames; name pools are fictional. */

export type TeamSeed = {
  city: string;
  name: string;
  abbr: string;
  colors: [string, string];
  conference: 'East' | 'West';
  division: string;
  budget: 'small' | 'mid' | 'large';
  strength: string;
};

/** Display name for a club: the city, plus a nickname when one is set. */
export const teamName = (t: { city: string; name: string }) => (t.name ? `${t.city} ${t.name}` : t.city);

export const TEAM_SEEDS: TeamSeed[] = [
  // East — Atlantic division
  { city: 'New York', name: '', abbr: 'NYC', colors: ['#006bb6', '#f58426'], conference: 'East', division: 'Atlantic', budget: 'large', strength: 'Guards' },
  { city: 'Boston', name: '', abbr: 'BOS', colors: ['#007a33', '#ffffff'], conference: 'East', division: 'Atlantic', budget: 'large', strength: 'Shooting' },
  { city: 'Brooklyn', name: '', abbr: 'BKN', colors: ['#000000', '#ffffff'], conference: 'East', division: 'Atlantic', budget: 'large', strength: 'Athletes' },
  { city: 'Philadelphia', name: '', abbr: 'PHI', colors: ['#006bb6', '#ed174c'], conference: 'East', division: 'Atlantic', budget: 'mid', strength: 'Size' },
  { city: 'Toronto', name: '', abbr: 'TOR', colors: ['#ce1141', '#000000'], conference: 'East', division: 'Atlantic', budget: 'mid', strength: 'Depth' },
  // East — Central division
  { city: 'Chicago', name: '', abbr: 'CHI', colors: ['#ce1141', '#000000'], conference: 'East', division: 'Central', budget: 'large', strength: 'Guards' },
  { city: 'Cleveland', name: '', abbr: 'CLE', colors: ['#860038', '#fdbb30'], conference: 'East', division: 'Central', budget: 'mid', strength: 'Rebounding' },
  { city: 'Detroit', name: '', abbr: 'DET', colors: ['#c8102e', '#1d42ba'], conference: 'East', division: 'Central', budget: 'mid', strength: 'Defense' },
  { city: 'Indiana', name: '', abbr: 'IND', colors: ['#002d62', '#fdbb30'], conference: 'East', division: 'Central', budget: 'small', strength: 'Pace' },
  { city: 'Milwaukee', name: '', abbr: 'MIL', colors: ['#00471b', '#eee1c6'], conference: 'East', division: 'Central', budget: 'small', strength: 'Size' },
  // East — Southeast division
  { city: 'Atlanta', name: '', abbr: 'ATL', colors: ['#e03a3e', '#c1d32f'], conference: 'East', division: 'Southeast', budget: 'mid', strength: 'Shooting' },
  { city: 'Charlotte', name: '', abbr: 'CHA', colors: ['#1d1160', '#00788c'], conference: 'East', division: 'Southeast', budget: 'small', strength: 'Athletes' },
  { city: 'Miami', name: '', abbr: 'MIA', colors: ['#98002e', '#f9a01b'], conference: 'East', division: 'Southeast', budget: 'large', strength: 'Defense' },
  { city: 'Orlando', name: '', abbr: 'ORL', colors: ['#0077c0', '#c4ced4'], conference: 'East', division: 'Southeast', budget: 'mid', strength: 'Size' },
  { city: 'Washington', name: '', abbr: 'WAS', colors: ['#002b5c', '#e31837'], conference: 'East', division: 'Southeast', budget: 'mid', strength: 'Passing' },
  // West — Northwest division
  { city: 'Denver', name: '', abbr: 'DEN', colors: ['#0e2240', '#fec524'], conference: 'West', division: 'Northwest', budget: 'mid', strength: 'Passing' },
  { city: 'Minnesota', name: '', abbr: 'MIN', colors: ['#0c2340', '#78be20'], conference: 'West', division: 'Northwest', budget: 'mid', strength: 'Defense' },
  { city: 'Oklahoma City', name: '', abbr: 'OKC', colors: ['#007ac1', '#ef3b24'], conference: 'West', division: 'Northwest', budget: 'small', strength: 'Athletes' },
  { city: 'Portland', name: '', abbr: 'POR', colors: ['#e03a3e', '#000000'], conference: 'West', division: 'Northwest', budget: 'small', strength: 'Guards' },
  { city: 'Utah', name: '', abbr: 'UTA', colors: ['#002b5c', '#f9a01b'], conference: 'West', division: 'Northwest', budget: 'small', strength: 'Rebounding' },
  // West — Pacific division
  { city: 'Golden State', name: '', abbr: 'GSC', colors: ['#1d428a', '#ffc72c'], conference: 'West', division: 'Pacific', budget: 'large', strength: 'Shooting' },
  { city: 'LA', name: '', abbr: 'LAC', colors: ['#c8102e', '#1d428a'], conference: 'West', division: 'Pacific', budget: 'large', strength: 'Depth' },
  { city: 'Los Angeles', name: '', abbr: 'LAL', colors: ['#552583', '#fdb927'], conference: 'West', division: 'Pacific', budget: 'large', strength: 'Athletes' },
  { city: 'Phoenix', name: '', abbr: 'PHX', colors: ['#1d1160', '#e56020'], conference: 'West', division: 'Pacific', budget: 'mid', strength: 'Shooting' },
  { city: 'Sacramento', name: '', abbr: 'SAC', colors: ['#5a2d81', '#63727a'], conference: 'West', division: 'Pacific', budget: 'small', strength: 'Pace' },
  // West — Southwest division
  { city: 'Dallas', name: '', abbr: 'DAL', colors: ['#00538c', '#b8c4ca'], conference: 'West', division: 'Southwest', budget: 'large', strength: 'Guards' },
  { city: 'Houston', name: '', abbr: 'HOU', colors: ['#ce1141', '#000000'], conference: 'West', division: 'Southwest', budget: 'large', strength: 'Pace' },
  { city: 'Memphis', name: '', abbr: 'MEM', colors: ['#5d76a9', '#12173f'], conference: 'West', division: 'Southwest', budget: 'small', strength: 'Defense' },
  { city: 'New Orleans', name: '', abbr: 'NOL', colors: ['#0c2340', '#c8102e'], conference: 'West', division: 'Southwest', budget: 'small', strength: 'Size' },
  { city: 'San Antonio', name: '', abbr: 'SAN', colors: ['#c4ced4', '#000000'], conference: 'West', division: 'Southwest', budget: 'mid', strength: 'Passing' },
];

export const FIRST_NAMES = [
  'Marcus', 'Jalen', 'Darius', 'Tyrese', 'Andre', 'Malik', 'Devin', 'Isaiah', 'Caleb', 'Elijah', 'Jordan', 'Cameron', 'Trey', 'Keon',
  'Bryce', 'Xavier', 'Damon', 'Terrence', 'Lamar', 'Rashad', 'Quentin', 'Desmond', 'Corey', 'Andrew', 'Luka', 'Nikolai', 'Mateo',
  'Diego', 'Rafael', 'Santiago', 'Emeka', 'Chidi', 'Kofi', 'Kwame', 'Tariq', 'Omar', 'Yusuf', 'Hamid', 'Kenji', 'Hiro', 'Min-jun',
  'Wei', 'Arjun', 'Rohan', 'Sven', 'Lars', 'Mikko', 'Pierre', 'Julien', 'Bastien', 'Tomas', 'Marek', 'Dario', 'Paolo', 'Sean',
  'Liam', 'Connor', 'Brady', 'Tucker', 'Wyatt', 'Garrett', 'Hunter', 'Colby', 'Reggie', 'Otis', 'Clyde', 'Vernon', 'Earl', 'Moses',
  'Ezra', 'Gideon', 'Silas', 'Jasper', 'Felix', 'Hugo', 'Oscar', 'Theo', 'Miles', 'Nolan', 'Owen', 'Grant', 'Dante', 'Rico',
  'Javier', 'Alonso', 'Bruno', 'Thiago', 'Kai', 'Koa', 'Mana', 'Tevita', 'Sione', 'Jaylen', 'Deshawn', 'Kendrick', 'Trevon', 'Amari',
  'Zion', 'Malachi', 'Jabari', 'Kobe', 'Aaron', 'Ben', 'Chris', 'Dwayne', 'Frank', 'Glen', 'Henry', 'Ivan', 'Jamal', 'Kirk', 'Leon',
];

export const LAST_NAMES = [
  'Holloway', 'Brooks', 'Whitfield', 'Okafor', 'Mensah', 'Adeyemi', 'Nwosu', 'Diallo', 'Kovacs', 'Petrovic', 'Novak', 'Ivanov',
  'Larsen', 'Lindqvist', 'Virtanen', 'Moreau', 'Dubois', 'Lefevre', 'Rossi', 'Bianchi', 'Moretti', 'Garcia', 'Herrera', 'Morales',
  'Castillo', 'Vargas', 'Mendoza', 'Silva', 'Costa', 'Pereira', 'Tanaka', 'Sato', 'Watanabe', 'Kim', 'Park', 'Chen', 'Liu', 'Huang',
  'Patel', 'Sharma', 'Rao', 'Haddad', 'Nasser', 'Farouk', "O'Connell", 'Murphy', 'Gallagher', 'Doyle', 'Fitzgerald', 'McAllister',
  'Thompson', 'Washington', 'Jefferson', 'Coleman', 'Jenkins', 'Freeman', 'Gaines', 'Hairston', 'Battle', 'Booker', 'Carver',
  'Dawkins', 'Ellison', 'Fontaine', 'Greer', 'Hardaway', 'Ingram', 'Jett', 'Kingsley', 'Lockhart', 'Maddox', 'Nash', 'Ogden',
  'Pruitt', 'Quarles', 'Rucker', 'Stallworth', 'Tate', 'Underwood', 'Vance', 'Waller', 'Yancey', 'Zeller', 'Archer', 'Bishop',
  'Crane', 'Drummond', 'Easley', 'Fairchild', 'Gentry', 'Hightower', 'Iverly', 'Jansen', 'Keller', 'Langford', 'Mercer', 'Norwood',
  'Oakes', 'Pemberton', 'Redding', 'Sterling', 'Thornton', 'Upshaw', 'Valentine', 'Whitaker', 'Young', 'Ashby', 'Blackwell',
  'Calloway', 'Dunbar', 'Everett', 'Foster', 'Granger', 'Hayward', 'Irwin', 'Jordan', 'Knox', 'Lowell', 'Monroe', 'Neville',
  'Osei', 'Boateng', 'Kamara', 'Sesay', 'Toure', 'Keita', 'Fofana', 'Bamba', 'Achebe', 'Eze', 'Obi', 'Ruiz', 'Navarro', 'Fuentes',
  'Kealoha', 'Mahoe', 'Tuilagi', 'Fifita', 'Hakimi', 'Benali', 'Saleh', 'Rahman', 'Aziz', 'Abbott', 'Bradford', 'Chandler',
];

export const LEAGUE_NAME = 'Pixel Basketball League';
