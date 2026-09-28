// Converts a libsyn episode-guide page into line-based text.
// Section headings become "##Label", star icons become ★ ½ ☆.
export function normalizeGuide(html: string): string[] {
	let t = html.replace(/\n/g, ' ');
	t = t.replace(/<script.*?<\/script>|<style.*?<\/style>/gs, '');
	t = t.replace(/<em class=\s*"\s*fa fa-star-half-o"[^>]*>.*?<\/em>/g, '½');
	t = t.replace(/<em class=\s*"\s*fa fa-star-o"[^>]*>.*?<\/em>/g, '☆');
	t = t.replace(/<em class=\s*"\s*fa fa-star"[^>]*>.*?<\/em>/g, '★');
	t = t.replace(/<a[^>]*href=\s*"(https:\/\/directory\.libsyn\.com\/episode\/[^"]+)"[^>]*>/g, '@@$1@@');
	t = t.replace(/<br\s*\/?>|<\/p>|<hr\s*\/?>|<\/li>|<\/h\d>/g, '\n');
	t = t.replace(/<strong>|<b>|<h\d[^>]*>/g, '\n##');
	t = decode(t.replace(/<[^>]+>/g, ''));
	t = t.replace(/[ \t ]+/g, ' ');
	t = t.replace(/''/g, "'");
	return t
		.split('\n')
		.map((l: string) => l.trim())
		.filter(Boolean);
}

export function decode(s: string): string {
	return s
		.replace(/&nbsp;/g, ' ')
		.replace(/&quot;/g, '"')
		.replace(/&#0?39;|&rsquo;|&lsquo;|&#8217;/g, "'")
		.replace(/&ldquo;|&rdquo;/g, '"')
		.replace(/&ndash;|&#8211;/g, '–')
		.replace(/&mdash;|&#8212;/g, '—')
		.replace(/&hellip;/g, '…')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&#(\d+);/g, (_: string, n: string) => String.fromCodePoint(+n))
		.replace(/&#x([0-9a-f]+);/gi, (_: string, n: string) => String.fromCodePoint(parseInt(n, 16)))
		.replace(/&amp;/g, '&');
}
