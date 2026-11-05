import { redirect } from 'next/navigation';

/** Free rewards ended when real-money play began. */
export default function RewardsPage() {
  redirect('/wallet');
}
