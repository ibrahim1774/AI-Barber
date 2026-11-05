// A hostile corpus for the guide library (Step 8): sentences a guide page must NEVER be able to print. Every entry has to be refused by
// libraryProblems() (copyRules.copyProblems + the independent default-deny layer svcDeny.denyProblems with no group skipped).
// Written independently of the library: praise, ratings, credentials, health and growth claims, prices, durations, guarantees,
// results, products and brands, first person, other trades, places, testimonials, tools, and sentence shapes that are not advice or definitions.
export const HOSTILE: string[] = [
  // praise and rank about a shop or barber
  'Our barbers are the best in town.', 'This shop is the top choice for a fade.', 'Ask for the finest cut available.', 'Book with the most trusted barbers around.',
  'The barbers here are highly skilled.', 'The team is friendly and professional.', 'Ask for our award winning fade.', 'This is the number one barbershop.',
  'The cuts are always perfect.', 'A premium experience awaits you.', 'Ask for the best haircut of your life.', 'These barbers are experts at every style.',
  'The shop is known for quality work.', 'Our precision cuts are unmatched.', 'A luxury haircut is worth the visit.', 'The finest barbers offer the sharpest lines.',
  'Ask for the most popular cut in the shop.', 'The barber is a master of the fade.', 'Come to the best fade shop around.', 'You will love how it turns out.',
  // ratings, reviews, testimonials, people
  'Customers say this is the best cut they ever had.', 'Many clients return every week.', 'The shop has five star reviews.', 'Read our reviews before you book.',
  'Thousands of people trust this barber.', 'Ask a regular how the cut turned out.', 'One client said the fade changed his life.', 'This barber is rated highly.',
  'Everyone leaves happy.', 'A happy customer is a returning customer.', 'The reviews speak for themselves.', 'Ask the shop for testimonials.',
  // credentials and tenure
  'The barbers are licensed and insured.', 'Our team has years of experience.', 'Ask about the training of your barber.', 'The shop has served the city for decades.',
  'The barbers are certified professionals.', 'Ask for a barber with many years behind the chair.', 'The shop was established long ago.', 'A trained barber knows how to handle every hair type.',
  'The barber is an award winner.', 'Ask about the license of your barber.', 'The family owned shop has a long history.', 'These are skilled and seasoned barbers.',
  // health, scalp, growth, outcomes on the body
  'A good cut can help your hair grow faster.', 'This treatment can prevent hair loss.', 'Ask your barber about your scalp.', 'Regular cuts make hair grow thicker.',
  'A trim can cure dandruff.', 'Ask for a cut that is healthy for your skin.', 'The service will relax you and relieve stress.', 'A hot towel can ease tension.',
  'This cut is safe for sensitive skin.', 'The shave leaves your skin soft and smooth.', 'Ask about treatments for thinning hair.', 'Cutting hair stimulates growth.',
  'A massage can improve blood circulation.', 'A fade helps you feel more confident.', 'The cut will boost your confidence.', 'Hair grows stronger after a trim.',
  // prices, offers, duration, booking and business facts
  'A haircut costs a small fee.', 'Ask about our prices.', 'Book online for a discount.', 'The first cut is free.',
  'Pay by card or cash at the chair.', 'A fade takes about half an hour.', 'The visit lasts around forty minutes.', 'Walk-ins are welcome all week.',
  'Ask about a membership for regular cuts.', 'Call the shop to schedule a time.', 'Ask for an appointment at the front desk.', 'The shop is open every day.',
  'Parking is available behind the building.', 'Tip your barber at the end of the cut.', 'Cancel at least a day before.', 'Ask about the gift cards.',
  'Check the website for hours.', 'Text the shop to book.', 'Follow the shop on social media.', 'Ask about the deposit.',
  // promises, guarantees, always and never
  'The cut is guaranteed to last.', 'Satisfaction is promised on every visit.', 'You will leave looking great.', 'Ask for a cut that always looks sharp.',
  'The result will be perfect.', 'A refund is offered if you are unhappy.', 'You will never need a second visit.', 'Every cut is done right the first time.',
  'The cut will be exactly what you want.', 'A great cut is certain.', 'Your satisfaction is the priority.', 'The barber will make it right.',
  // results and comparisons
  'A fade looks better than a taper.', 'This cut is more flattering than the others.', 'The result is long lasting.', 'Ask for a cut that lasts all month.',
  'It is the easiest style to keep.', 'A low fade is the best choice for most men.', 'The cleanest lines come from a razor.', 'Ask for the freshest look.',
  // products, brands and tools
  'Ask for a pomade to hold the style.', 'Use a brand name gel for the best hold.', 'Ask your barber about a product for dry hair.', 'Buy the shampoo at the shop.',
  'Ask for clippers set to a low guard.', 'The barbers use only premium clippers.', 'Ask whether the cologne is included.', 'Ask for beard oil after the trim.',
  'A named wax holds the shape.', 'Try a sea salt spray for texture.', 'Ask for the clay that suits your hair.', 'The shop sells hair care products.',
  // first person, we, our, us
  'We will take care of you.', 'Our barbers listen to you.', 'Tell us what you want.', 'We recommend a low fade.',
  'I think a fade suits you.', 'Ask me about the cut.', 'Tell me what style you like.', 'My favorite style is the quiff.',
  // places and names
  'Visit the shop in downtown Brooklyn.', 'The shop is near the station.', 'The best barber in Austin.', 'A cut in Texas costs less.',
  'Ask about the shop on Main Street.', 'The barber from Chicago knows fades.', 'Come to the shop near you.', 'Ask for Tony at the front.',
  // other trades and verticals
  'Ask about a tattoo near the hairline.', 'A manicure goes well with a cut.', 'Ask about a facial after the shave.', 'Book a massage with your haircut.',
  'Ask about lash extensions.', 'Ask about waxing for the neck.', 'A pedicure is available too.', 'Ask about eyebrow threading.',
  // shapes that are not advice or a definition, and odd characters
  'Haircuts suit many hair types.', 'Fades are popular again.', 'Short hair is easy to style.', 'Hair grows back in time.',
  'Ask for the cut & style combo.', 'Ask for a cut / trim.', 'Ask for a cut (any style).', 'Ask for the cut!',
  'Ask for a cut -- any style.', 'ASK FOR A FADE.', 'Ask for a cut"', 'Ask for the l i c e n s e.',
  'Ask para el corte con la barba.', 'Pida su cita ahora.', 'Ask for a cut—any style.', 'Ask for a cut’s finish.',
  // digits and numbers
  'Ask for a 2 inch trim.', 'Bring 3 photos of the cut.', 'Ask for a number 2 guard.', 'Return in 4 weeks.',
  'Ask for one hundred percent coverage.', 'Plan for twenty minutes in the chair.', 'Ask about the first ten visits.', 'Bring two photos.',
  // misc claims about the shop and results
  'The shop is clean and well kept.', 'The shop is spotless and sanitized.', 'Ask for a calm and quiet visit.', 'The chairs are comfortable.',
  'Ask for the coffee and the music.', 'The staff is welcoming.', 'The shop is open late.', 'The environment is relaxed.',
  'This guide was written by a licensed barber.', 'The tips come from years of cutting hair.', 'Experts agree a fade suits everyone.', 'Studies show regular cuts help hair.',
  'Doctors recommend a trim every month.', 'The shop recommends a low fade.', 'Hair loss can be reduced with a good cut.', 'A trim removes damaged hair.',
  // one-group probes (each is refused by one deny group and by no copy rule, so the mutation test can prove the group is load bearing)
  'Ask your barber about the policy on redoing a cut.', 'Ask for the sharpest edges.', 'Ask for a quick trim.', 'Ask for results that fit your style.',
  'If you ask, the barber handles it.', 'Ask about the cuidado of your hair.', 'Ask about a l i c e n s e.', 'Ask about the station.',
];
