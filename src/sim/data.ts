/** Fictional league data: cities, clubs and name pools. None of these are real franchises. */

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

export const TEAM_SEEDS: TeamSeed[] = [
  // East — Harbor division
  { city: 'Harbor City', name: 'Gulls', abbr: 'HCG', colors: ['#c8102e', '#f2f2f2'], conference: 'East', division: 'Harbor', budget: 'large', strength: 'Shooting' },
  { city: 'Port Calloway', name: 'Lanterns', abbr: 'PCL', colors: ['#f2a900', '#1c1c3c'], conference: 'East', division: 'Harbor', budget: 'mid', strength: 'Guards' },
  { city: 'New Halden', name: 'Ironclads', abbr: 'NHI', colors: ['#3d4a5c', '#e5c07b'], conference: 'East', division: 'Harbor', budget: 'large', strength: 'Defense' },
  { city: 'Bayshore', name: 'Breakers', abbr: 'BAY', colors: ['#0f7fa8', '#f7f1e3'], conference: 'East', division: 'Harbor', budget: 'mid', strength: 'Pace' },
  { city: 'Kingsbridge', name: 'Monarchs', abbr: 'KGB', colors: ['#5b2a86', '#f4c542'], conference: 'East', division: 'Harbor', budget: 'small', strength: 'Size' },
  // East — Rust division
  { city: 'Steelhaven', name: 'Forge', abbr: 'STF', colors: ['#d4571c', '#232323'], conference: 'East', division: 'Rust', budget: 'mid', strength: 'Rebounding' },
  { city: 'Millbrook', name: 'Grinders', abbr: 'MIL', colors: ['#6b4f2a', '#efe6d2'], conference: 'East', division: 'Rust', budget: 'small', strength: 'Defense' },
  { city: 'Lake Verona', name: 'Pikes', abbr: 'LVP', colors: ['#1f6f50', '#d9e4dd'], conference: 'East', division: 'Rust', budget: 'mid', strength: 'Passing' },
  { city: 'Granite Falls', name: 'Rockhounds', abbr: 'GFR', colors: ['#7a7d85', '#b8202f'], conference: 'East', division: 'Rust', budget: 'small', strength: 'Size' },
  { city: 'Old Fenwick', name: 'Foxes', abbr: 'OFF', colors: ['#e0662a', '#20304a'], conference: 'East', division: 'Rust', budget: 'mid', strength: 'Athletes' },
  // East — Pine division
  { city: 'Cedar Point', name: 'Ospreys', abbr: 'CPT', colors: ['#2e5e3a', '#c7a46b'], conference: 'East', division: 'Pine', budget: 'mid', strength: 'Depth' },
  { city: 'Ashford', name: 'Aviators', abbr: 'ASH', colors: ['#2457a6', '#ff7a1a'], conference: 'East', division: 'Pine', budget: 'large', strength: 'Pace' },
  { city: 'Briar Glen', name: 'Bramblers', abbr: 'BGB', colors: ['#f5d10a', '#141414'], conference: 'East', division: 'Pine', budget: 'small', strength: 'Guards' },
  { city: 'Northgate', name: 'Sentinels', abbr: 'NGS', colors: ['#14284b', '#c9d2e3'], conference: 'East', division: 'Pine', budget: 'large', strength: 'Defense' },
  { city: 'Riverton', name: 'Otters', abbr: 'RVR', colors: ['#16a0a0', '#0e2a3a'], conference: 'East', division: 'Pine', budget: 'mid', strength: 'Shooting' },
  // West — Mesa division
  { city: 'Mesa Roja', name: 'Vipers', abbr: 'MRV', colors: ['#a31f34', '#f0b323'], conference: 'West', division: 'Mesa', budget: 'mid', strength: 'Athletes' },
  { city: 'Dustwater', name: 'Drifters', abbr: 'DWD', colors: ['#c99459', '#3a2a1f'], conference: 'West', division: 'Mesa', budget: 'small', strength: 'Shooting' },
  { city: 'Sol Vista', name: 'Scorchers', abbr: 'SVS', colors: ['#ff8c1a', '#4a1e6e'], conference: 'West', division: 'Mesa', budget: 'large', strength: 'Pace' },
  { city: 'Canyon Ridge', name: 'Condors', abbr: 'CRC', colors: ['#8c3b1c', '#e8d5b0'], conference: 'West', division: 'Mesa', budget: 'mid', strength: 'Size' },
  { city: 'Ember Flats', name: 'Coyotes', abbr: 'EFC', colors: ['#b04a1a', '#2b2b2b'], conference: 'West', division: 'Mesa', budget: 'small', strength: 'Defense' },
  // West — Summit division
  { city: 'Highpeak', name: 'Glaciers', abbr: 'HPA', colors: ['#dfe8f0', '#2b4d7a'], conference: 'West', division: 'Summit', budget: 'large', strength: 'Size' },
  { city: 'Frostvale', name: 'Yetis', abbr: 'FVY', colors: ['#7fb7d8', '#ffffff'], conference: 'West', division: 'Summit', budget: 'small', strength: 'Rebounding' },
  { city: 'Timberline', name: 'Lumberjacks', abbr: 'TLJ', colors: ['#3c6e2b', '#d03a2a'], conference: 'West', division: 'Summit', budget: 'mid', strength: 'Depth' },
  { city: 'Silver Crest', name: 'Stallions', abbr: 'SCS', colors: ['#9aa3ad', '#1f1f3a'], conference: 'West', division: 'Summit', budget: 'large', strength: 'Guards' },
  { city: 'Pinecrest', name: 'Owls', abbr: 'PCO', colors: ['#5a4632', '#f2c879'], conference: 'West', division: 'Summit', budget: 'mid', strength: 'Passing' },
  // West — Coast division
  { city: 'Bay Marisol', name: 'Waves', abbr: 'BMW', colors: ['#0a74c9', '#ffd447'], conference: 'West', division: 'Coast', budget: 'large', strength: 'Shooting' },
  { city: 'Seacliff', name: 'Sandpipers', abbr: 'SCP', colors: ['#1d3c5c', '#e3a85b'], conference: 'West', division: 'Coast', budget: 'mid', strength: 'Defense' },
  { city: 'Neon Bay', name: 'Glow', abbr: 'NBG', colors: ['#e5267f', '#2bd9c4'], conference: 'West', division: 'Coast', budget: 'large', strength: 'Pace' },
  { city: 'Coral Springs', name: 'Mantas', abbr: 'CSM', colors: ['#ff6f61', '#123c46'], conference: 'West', division: 'Coast', budget: 'small', strength: 'Athletes' },
  { city: 'Fogport', name: 'Harpooners', abbr: 'FPM', colors: ['#2f4f4f', '#d9c27a'], conference: 'West', division: 'Coast', budget: 'mid', strength: 'Passing' },
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
