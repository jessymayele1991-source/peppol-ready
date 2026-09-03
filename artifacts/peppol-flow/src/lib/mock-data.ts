export type PeppolStatus = 'Ready' | 'Configuring' | 'At risk' | 'Not registered';
export type Severity = 'critical' | 'warning' | 'info';

export type Organization = {
  id: string;
  name: string;
  slug: string;
  plan: string;
};

export type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  avatarInitials: string;
};

export type Membership = {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
};

export type Client = {
  id: string;
  name: string;
  initials: string;
  email: string;
  accountingPackage: string;
  peppolStatus: PeppolStatus;
  readinessScore: number;
  lastChecked: string;
  actionLabel: string;
};

export type Incident = {
  id: string;
  title: string;
  clientName: string;
  severity: Severity;
  timestamp: string;
};

export type Action = {
  id: string;
  title: string;
  count: number;
  severity: Severity;
};

export type ReadinessSnapshot = {
  label: string;
  ready: number;
  configuring: number;
  atRisk: number;
  notRegistered: number;
  total: number;
};

export type TrendPoint = { month: string; score: number };

export const organization: Organization = {
  id: 'org_northstar_accounting',
  name: 'Northstar Accounting',
  slug: 'northstar-accounting',
  plan: 'Professional',
};

export const user: User = {
  id: 'usr-01',
  name: 'Elise Martin',
  email: 'elise@northstar.be',
  role: 'Workspace owner',
  avatarInitials: 'EM',
};

export const memberships: Membership[] = [
  { id: 'mem-01', organizationId: 'org-01', userId: 'usr-01', role: 'Owner' },
  { id: 'mem-02', organizationId: 'org-01', userId: 'usr-02', role: 'Admin' },
  { id: 'mem-03', organizationId: 'org-01', userId: 'usr-03', role: 'Member' },
];

export const clients: Client[] = [
  { id: 'cli-01', name: 'Veldman & Co', initials: 'VC', email: 'hello@veldman.co', accountingPackage: 'WinBooks', peppolStatus: 'Ready', readinessScore: 96, lastChecked: 'Today, 09:42', actionLabel: 'View' },
  { id: 'cli-02', name: 'Atelier Noma', initials: 'AN', email: 'finance@ateliernoma.be', accountingPackage: 'Exact Online', peppolStatus: 'Configuring', readinessScore: 68, lastChecked: 'Today, 08:15', actionLabel: 'Review' },
  { id: 'cli-03', name: 'Fjord Logistics', initials: 'FL', email: 'ops@fjordlogistics.eu', accountingPackage: 'Odoo', peppolStatus: 'At risk', readinessScore: 42, lastChecked: 'Yesterday, 16:20', actionLabel: 'Resolve' },
  { id: 'cli-04', name: 'Maison Karel', initials: 'MK', email: 'hello@maisonkarel.com', accountingPackage: 'Yuki', peppolStatus: 'Ready', readinessScore: 91, lastChecked: 'Yesterday, 14:04', actionLabel: 'View' },
  { id: 'cli-05', name: 'Brightwell Studio', initials: 'BS', email: 'accounts@brightwell.studio', accountingPackage: 'Excel / None', peppolStatus: 'Not registered', readinessScore: 12, lastChecked: 'Mon, 11:36', actionLabel: 'Start setup' },
  { id: 'cli-06', name: 'Oostende Works', initials: 'OW', email: 'team@oostendeworks.be', accountingPackage: 'Exact Online', peppolStatus: 'Configuring', readinessScore: 74, lastChecked: 'Mon, 09:12', actionLabel: 'Review' },
];

export const incidents: Incident[] = [
  { id: 'inc-01', title: 'Invoice rejected by access point', clientName: 'Fjord Logistics', severity: 'critical', timestamp: 'Today, 09:32' },
  { id: 'inc-02', title: 'Endpoint certificate expires soon', clientName: 'Atelier Noma', severity: 'warning', timestamp: 'Today, 08:15' },
  { id: 'inc-03', title: 'Receiver not found', clientName: 'Brightwell Studio', severity: 'critical', timestamp: 'Yesterday, 17:45' },
  { id: 'inc-04', title: 'UBL validation failed', clientName: 'Oostende Works', severity: 'warning', timestamp: 'Yesterday, 14:22' },
  { id: 'inc-05', title: 'Access point timeout', clientName: 'Maison Karel', severity: 'warning', timestamp: 'Yesterday, 11:08' },
];

export const actions: Action[] = [
  { id: 'act-01', title: 'Clients not registered', count: 27, severity: 'critical' },
  { id: 'act-02', title: 'Missing receiving address', count: 12, severity: 'critical' },
  { id: 'act-03', title: 'No Peppol-ready software', count: 15, severity: 'warning' },
  { id: 'act-04', title: 'Validation needs review', count: 8, severity: 'warning' },
  { id: 'act-05', title: 'Incomplete information', count: 7, severity: 'info' },
];

export const readiness: ReadinessSnapshot = {
  label: '30 Jun 2024',
  ready: 218,
  configuring: 89,
  atRisk: 35,
  notRegistered: 27,
  total: 369,
};

export const trend: TrendPoint[] = [
  { month: 'Jan', score: 48 },
  { month: 'Feb', score: 55 },
  { month: 'Mar', score: 61 },
  { month: 'Apr', score: 66 },
  { month: 'May', score: 72 },
  { month: 'Jun', score: 78 },
];
