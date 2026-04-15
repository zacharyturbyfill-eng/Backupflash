import { redirect } from 'next/navigation';

export default function RootPage() {
  // Redirect thẳng vào trang login khi vào root
  redirect('/login');
}
