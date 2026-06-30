import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://oucdymkbbsizwlgeiglr.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im91Y2R5bWtiYnNpendsZ2VpZ2xyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4MTg3NDIsImV4cCI6MjA5ODM5NDc0Mn0.qX8A6boU9D4G9mwXqnZYyqWZPlO1256Wy7pQyJxYfkk'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
