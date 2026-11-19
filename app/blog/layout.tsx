import './blog.css';
import { BlogFooter, BlogHeader } from '@/components/blog/BlogChrome';

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="blog-shell">
      <BlogHeader />
      <main className="blog-main">{children}</main>
      <BlogFooter />
    </div>
  );
}
