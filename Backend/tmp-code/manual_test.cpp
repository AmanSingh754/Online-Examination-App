#include <iostream>
#include <string>
#include <unordered_map>
using namespace std;
char firstNonRepeatingChar(const string& str){ unordered_map<char,int> c; for(char ch: str) c[ch]++; for(char ch: str) if(c[ch]==1) return ch; return '#'; }
int main(){ string s; getline(cin,s); cout<<firstNonRepeatingChar(s); return 0; }
